/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * 
 * Lib_Advisor_QueryExecution.js
 * Query generation and execution for the Advisor module
 * 
 * Contains EXACT copies of these functions from original Lib_Advisor_Orchestrator.js:
 * - executeQueryWithRetries (line 5451)
 * - applyTemplateFormatting (line 5550)
 * - extractTopicsFromQuery (line 5592)
 * - retryWithError (line 5615)
 * - interpretResults (line 5680)
 * - parseRichContentFromAI (line 5843)
 * - parseRichContentCore (line 5887)
 * - sortRichContent (line 5970)
 * - isSingleTransactionResult (line 5992)
 * - buildTransactionCardData (line 6042)
 * - detectTransactionType (line 6154)
 * - buildChartDataFromResult (line 6182)
 * - generateQueryWithAI (line 5330)
 * - parseAIResponse (line 5403)
 * - buildQueryFromTemplate (line 4609)
 * - executeTemplate (line 3328)
 * - buildRAGDocuments (line 4745)
 * - getSchemaDoc (line 4795)
 */
define([
    'N/log',
    'N/llm',
    './Lib_Advisor_AIProviders',
    './Lib_Advisor_Prompts',
    './Lib_Advisor_Templates',
    './Lib_Advisor_QueryExecutor',
    './Lib_Advisor_QueryValidator',
    './Lib_Advisor_ResponseBuilder',
    './Lib_Advisor_Planning',
    './Lib_Advisor_Utils',
    './Lib_Advisor_ToolDefinitions'
], function(log, llm, AIProviders, Prompts, Templates, QueryExecutor, QueryValidator, ResponseBuilder, Planning, Utils, ToolDefinitions) {
    'use strict';

    // Constants from original
    const MAX_RETRIES = 2;
    const DEFAULT_MAX_TOKENS = Utils.DEFAULT_MAX_TOKENS;

    // ═══════════════════════════════════════════════════════════════════════════════
    // SUITEQL_TOOL - from original line 4885
    // ═══════════════════════════════════════════════════════════════════════════════
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

    // ═══════════════════════════════════════════════════════════════════════════════
    // executeQueryWithRetries - EXACT copy from original line 5451
    // ═══════════════════════════════════════════════════════════════════════════════
    function executeQueryWithRetries(message, history, documents, query, description, steps, startTime, attempt, fiscalContext, sessionContext) {
        
        // Add query step
        steps.push({
            type: 'query',
            title: 'Executing SuiteQL',
            content: query,
            description: description,
            status: 'running',
            attempt: attempt + 1,
            timestamp: Date.now()
        });
        
        // Validate
        const validation = QueryValidator.validateQuery(query);
        if (!validation.valid) {
            steps[steps.length - 1].status = 'error';
            steps[steps.length - 1].error = validation.reason;
            
            if (attempt < MAX_RETRIES) {
                return retryWithError(message, history, documents, query, validation.reason, validation.suggestion, steps, startTime, attempt, fiscalContext, sessionContext);
            }
            
            const response = ResponseBuilder.buildResponse('Query validation failed: ' + validation.reason, steps, startTime, AIProviders.getCurrentModelInfo());
            response.sessionContext = sessionContext; // Pass through on error
            response.needsReplan = true; // Signal to orchestrator to try different approach
            response.failureReason = 'max_retries_exceeded';
            return response;
        }
        
        // Execute
        const result = QueryExecutor.executeQuery(query);
        
        if (!result.success) {
            steps[steps.length - 1].status = 'error';
            steps[steps.length - 1].error = result.error;
            
            if (attempt < MAX_RETRIES) {
                return retryWithError(message, history, documents, query, result.error, null, steps, startTime, attempt, fiscalContext, sessionContext);
            }
            
            const response = ResponseBuilder.buildResponse('Query failed: ' + result.error, steps, startTime, AIProviders.getCurrentModelInfo());
            response.sessionContext = sessionContext; // Pass through on error
            response.needsReplan = true; // Signal to orchestrator to try different approach
            response.failureReason = 'max_retries_exceeded';
            return response;
        }
        
        // Success
        steps[steps.length - 1].status = 'complete';
        steps[steps.length - 1].rowCount = result.rowCount;
        steps[steps.length - 1].columns = result.columns;
        steps[steps.length - 1].preview = result.rows.slice(0, 3);
        
        // Analyze results
        steps.push({
            type: 'analyzing',
            title: 'Analyzing ' + result.rowCount + ' rows',
            status: 'complete',
            timestamp: Date.now()
        });
        
        // Extract grand totals from result (removes repeated columns, extracts values)
        var processedResult = extractGrandTotals(result);
        var grandTotals = processedResult.grandTotals;
        
        // Create cleaned result with grand totals removed from rows
        var cleanedResult = Object.assign({}, result, {
            rows: processedResult.rows,
            columns: processedResult.columns,
            grandTotals: grandTotals
        });
        
        // Apply template formatting if available (pre-formats data before interpretation)
        var formattedResult = cleanedResult;
        if (sessionContext && sessionContext.templateFormat) {
            formattedResult = applyTemplateFormatting(cleanedResult, sessionContext.templateFormat);
        }
        
        // Interpret - pass template hints and grand totals for richer output
        const interpretOptions = {
            templateFormat: sessionContext ? sessionContext.templateFormat : null,
            templateChart: sessionContext ? sessionContext.templateChart : null,
            grandTotals: grandTotals
        };
        const interpretation = interpretResults(message, description, formattedResult, history, documents, fiscalContext, interpretOptions);
        
        // Update session context with query results for follow-ups
        const updatedSessionContext = Planning.updateSessionContext(sessionContext, {
            queryResult: result,
            query: query,
            topics: Utils.extractTopicsFromQuery(message, description)
        });
        
        // Build response with blocks format from interpretation
        // Always include model/provider - fallback to current model info if interpretation doesn't provide them
        const modelInfo = AIProviders.getCurrentModelInfo();
        const response = ResponseBuilder.buildResponse('', steps, startTime, {
            model: interpretation.model || modelInfo.model,
            provider: interpretation.provider || modelInfo.provider
        });
        
        // Use richContent directly from interpretation (already in blocks format)
        response.richContent = interpretation.richContent || [];
        response.blocksFormat = interpretation.blocksFormat || false;
        
        // Check if 0 results might indicate a query problem (not just empty data)
        // Heuristics: time-based queries or specific record lookups should have data
        if (result.rowCount === 0) {
            const messageLower = message.toLowerCase();
            // Time-based queries that should typically have data
            const expectsData = /this month|this year|last month|last year|ytd|year to date|current|recent|today|yesterday|past \d+/i.test(messageLower);
            // Aggregation queries typically return at least 1 row
            const isAggregation = /total|sum|count|average|by department|by customer|by vendor|by employee/i.test(messageLower);
            
            if (expectsData || isAggregation) {
                response.needsReplan = true;
                response.failureReason = 'zero_results_unexpected';
                log.debug('Zero results on expected-data query, flagging for replan', {
                    expectsData: expectsData,
                    isAggregation: isAggregation
                });
            }
        }
        
        // Add followUpSuggestions if available from template context
        if (sessionContext && sessionContext.followUpSuggestions) {
            response.followUpSuggestions = sessionContext.followUpSuggestions;
        }
        
        response.sessionContext = updatedSessionContext; // Return updated session context
        return response;
    }
    
    // ═══════════════════════════════════════════════════════════════════════════════
    // applyTemplateFormatting - EXACT copy from original line 5550
    // ═══════════════════════════════════════════════════════════════════════════════
    
    /**
     * Extract grand_total columns from results and remove them from rows.
     * Returns { rows: [...cleaned rows...], grandTotals: { col: value, ... } }
     */
    function extractGrandTotals(result) {
        if (!result || !result.rows || result.rows.length === 0) {
            return { rows: result.rows, columns: result.columns, grandTotals: {} };
        }
        
        // Find columns that start with "grand_total"
        var grandTotalCols = result.columns.filter(function(col) {
            return col.toLowerCase().indexOf('grand_total') === 0;
        });
        
        if (grandTotalCols.length === 0) {
            return { rows: result.rows, columns: result.columns, grandTotals: {} };
        }
        
        // Extract values from first row (they're the same on all rows)
        var grandTotals = {};
        grandTotalCols.forEach(function(col) {
            grandTotals[col] = result.rows[0][col];
        });
        
        // Remove grand_total columns from all rows and columns list
        var cleanedColumns = result.columns.filter(function(col) {
            return col.toLowerCase().indexOf('grand_total') !== 0;
        });
        
        var cleanedRows = result.rows.map(function(row) {
            var newRow = {};
            cleanedColumns.forEach(function(col) {
                newRow[col] = row[col];
            });
            return newRow;
        });
        
        return {
            rows: cleanedRows,
            columns: cleanedColumns,
            grandTotals: grandTotals
        };
    }
    
    function applyTemplateFormatting(result, templateFormat) {
        if (!templateFormat || !templateFormat.formatting) return result;
        
        const formatting = templateFormat.formatting;
        const formattedRows = result.rows.map(function(row) {
            const formattedRow = Object.assign({}, row);
            
            for (var colName in formatting) {
                if (!formatting.hasOwnProperty(colName)) continue;
                var format = formatting[colName];
                
                // Find the column (case-insensitive)
                const actualCol = result.columns.find(function(c) { return c.toLowerCase() === colName.toLowerCase(); });
                if (!actualCol || row[actualCol] === null || row[actualCol] === undefined) continue;
                
                const value = row[actualCol];
                
                // Apply formatting
                if (format === 'currency' && typeof value === 'number') {
                    formattedRow[actualCol + '_formatted'] = new Intl.NumberFormat('en-US', {
                        style: 'currency',
                        currency: 'USD',
                        minimumFractionDigits: 0,
                        maximumFractionDigits: 0
                    }).format(value);
                } else if (format === 'percent' && typeof value === 'number') {
                    formattedRow[actualCol + '_formatted'] = (value * 100).toFixed(1) + '%';
                } else if (format === 'number' && typeof value === 'number') {
                    formattedRow[actualCol + '_formatted'] = value.toLocaleString('en-US');
                }
            }
            
            return formattedRow;
        });
        
        return Object.assign({}, result, {
            rows: formattedRows,
            templateFormatApplied: true
        });
    }
    
    // NOTE: extractTopicsFromQuery removed - use Utils.extractTopicsFromQuery

    // ═══════════════════════════════════════════════════════════════════════════════
    // retryWithError - Query retry with dynamic schema fetching
    // ═══════════════════════════════════════════════════════════════════════════════
    function retryWithError(message, history, documents, failedQuery, error, suggestion, steps, startTime, attempt, fiscalContext, sessionContext) {
        steps.push({
            type: 'retry',
            title: 'Fixing query error',
            error: error,
            suggestion: suggestion,
            status: 'running',
            timestamp: Date.now()
        });
        
        // ═══════════════════════════════════════════════════════════════
        // ENHANCED ERROR CONTEXT FOR COMMON ISSUES
        // ═══════════════════════════════════════════════════════════════
        let enhancedGuidance = '';
        
        // Check for common error patterns and provide specific fixes
        if (error.includes('Invalid or unsupported search')) {
            enhancedGuidance = `

═══════════════════════════════════════════════════════════════════════
IMPORTANT: "Invalid or unsupported search" COMMON CAUSES:
═══════════════════════════════════════════════════════════════════════
1. JOIN syntax wrong - CORRECT: INNER JOIN transactionline ON transactionline.transaction = transaction.id
                      WRONG:   JOIN transactionline ON transaction.id = transactionline.transaction
2. Column doesn't exist on that table
3. Missing table alias when needed
4. Trying to join non-joinable tables

KNOWN WORKING PATTERNS:
• Vendor bills with lines:
  FROM transaction
  INNER JOIN transactionline ON transactionline.transaction = transaction.id
  WHERE transaction.type = 'VendBill' AND transactionline.mainline = 'F'

• Expenses by account (using transactionaccountingline):
  FROM transactionaccountingline
  INNER JOIN transaction ON transactionaccountingline.transaction = transaction.id
  INNER JOIN account ON transactionaccountingline.account = account.id
  WHERE account.accttype = 'Expense'

DO NOT repeat the exact same query. You MUST change something.
═══════════════════════════════════════════════════════════════════════
`;
        } else if (error.includes('Field') && error.includes('not found')) {
            enhancedGuidance = `

═══════════════════════════════════════════════════════════════════════
FIELD NOT FOUND - Use these actual field names:
═══════════════════════════════════════════════════════════════════════
transaction: id, tranid, trandate, type, entity, foreigntotal, posting, voided, status
transactionline: transaction, item, quantity, netamount, department, class, location, mainline
transactionaccountingline: transaction, transactionline, account, amount, debit, credit
account: id, acctnumber, accttype, accountsearchdisplayname
vendor/customer: id, companyname, entityid, email

Use BUILTIN.DF(field) to get display names for ID fields.
═══════════════════════════════════════════════════════════════════════
`;
        }
        
        // Extract record type from error message if present
        // Pattern: "Field 'xxx' for record 'RecordType'"
        let dynamicSchema = '';
        const recordMatch = error.match(/for record '([^']+)'/i);
        if (recordMatch && recordMatch[1]) {
            const recordType = recordMatch[1].toLowerCase();
            
            // Map common record type names to SuiteScript record IDs
            const recordTypeMap = {
                'timebill': 'timebill',
                'transaction': 'salesorder', // Use salesorder as proxy for transaction fields
                'transactionline': 'salesorder',
                'transactionaccountingline': 'salesorder',
                'customer': 'customer',
                'vendor': 'vendor',
                'employee': 'employee',
                'item': 'inventoryitem',
                'account': 'account',
                'department': 'department',
                'location': 'location',
                'subsidiary': 'subsidiary',
                'project': 'job',
                'job': 'job'
            };
            
            const mappedType = recordTypeMap[recordType] || recordType;
            
            try {
                const schemaResult = Utils.getRecordSchema(mappedType);
                if (schemaResult && schemaResult.success && schemaResult.schema) {
                    // Get first 50 most useful fields
                    const fields = Object.keys(schemaResult.schema.fields).slice(0, 50);
                    dynamicSchema = '\n\n═══════════════════════════════════════════════════════════════════════\n';
                    dynamicSchema += 'ACTUAL FIELDS FOR ' + recordType.toUpperCase() + ' RECORD\n';
                    dynamicSchema += '═══════════════════════════════════════════════════════════════════════\n';
                    dynamicSchema += 'Available fields: ' + fields.join(', ') + '\n';
                    dynamicSchema += '\nUSE ONLY THESE FIELDS - the field in your query does NOT exist!\n';
                    
                    log.debug('Fetched schema for retry', { 
                        recordType: mappedType, 
                        fieldCount: fields.length 
                    });
                }
            } catch (schemaErr) {
                log.debug('Could not fetch schema for retry', { 
                    recordType: mappedType, 
                    error: schemaErr.message 
                });
            }
        }
        
        // Use centralized retry prompt with dynamic schema and enhanced guidance
        const systemPrompt = Prompts.buildRetryPrompt(fiscalContext, error, failedQuery, suggestion, dynamicSchema + enhancedGuidance);
        
        const retryResult = AIProviders.callAI(message, {
            systemPrompt: systemPrompt,
            chatHistory: history,
            documents: documents,
            tools: [SUITEQL_TOOL],
            maxTokens: DEFAULT_MAX_TOKENS,
            temperature: 0.2,
            purpose: 'Retry query generation',
            tier: 2  // Use balanced model for retries
        });
        
        // Handle tool call response
        if (retryResult.type === 'tool_call' && retryResult.toolCalls && retryResult.toolCalls.length > 0) {
            const toolCall = retryResult.toolCalls[0];
            if (toolCall.name === 'execute_suiteql' && toolCall.arguments.query) {
                const newQuery = toolCall.arguments.query;
                
                // ═══════════════════════════════════════════════════════════════
                // DUPLICATE QUERY DETECTION
                // ═══════════════════════════════════════════════════════════════
                const normalizeQuery = (q) => q.replace(/\s+/g, ' ').trim().toLowerCase();
                if (normalizeQuery(newQuery) === normalizeQuery(failedQuery)) {
                    log.audit('Duplicate query detected on retry', { 
                        attempt: attempt, 
                        query: newQuery.substring(0, 100) 
                    });
                    
                    // Don't retry with same query - signal failure
                    steps[steps.length - 1].status = 'error';
                    steps[steps.length - 1].error = 'LLM generated identical query on retry - cannot fix';
                    
                    if (attempt + 1 < MAX_RETRIES) {
                        // Add a stronger hint and try once more
                        steps.push({
                            type: 'retry',
                            title: 'Regenerating with stronger guidance',
                            error: 'Duplicate query detected - must use different approach',
                            status: 'complete',
                            timestamp: Date.now()
                        });
                        
                        // Force a different approach in the next retry by adding explicit instruction
                        const forceDifferentPrompt = systemPrompt + `

🚨 CRITICAL: You generated the EXACT SAME query that already failed. 
You MUST generate a DIFFERENT query. Options:
1. Use a different table (e.g., transactionaccountingline instead of transactionline)
2. Remove problematic JOINs
3. Simplify the query significantly
4. Use a known working pattern from above

DO NOT output the same query again.
`;
                        const forceRetryResult = AIProviders.callAI(message, {
                            systemPrompt: forceDifferentPrompt,
                            chatHistory: history,
                            documents: documents,
                            tools: [SUITEQL_TOOL],
                            maxTokens: DEFAULT_MAX_TOKENS,
                            temperature: 0.5,  // Higher temperature for more variation
                            purpose: 'Retry with forced variation',
                            tier: 2
                        });
                        
                        if (forceRetryResult.type === 'tool_call' && forceRetryResult.toolCalls?.[0]?.arguments?.query) {
                            const forcedQuery = forceRetryResult.toolCalls[0].arguments.query;
                            if (normalizeQuery(forcedQuery) !== normalizeQuery(failedQuery)) {
                                return executeQueryWithRetries(
                                    message, history, documents,
                                    forcedQuery,
                                    forceRetryResult.toolCalls[0].arguments.description || 'Retried with different approach',
                                    steps, startTime, attempt + 2, fiscalContext, sessionContext
                                );
                            }
                        }
                    }
                    
                    // All retries produced duplicates - give up
                    const response = ResponseBuilder.buildResponse(
                        'Unable to generate a working query. The system kept producing the same failing query.',
                        steps,
                        startTime,
                        AIProviders.getCurrentModelInfo()
                    );
                    response.sessionContext = sessionContext;
                    response.needsReplan = true;
                    response.failureReason = 'duplicate_queries';
                    return response;
                }
                
                steps[steps.length - 1].status = 'complete';
                return executeQueryWithRetries(
                    message, history, documents,
                    newQuery,
                    toolCall.arguments.description || 'Retried query',
                    steps, startTime, attempt + 1, fiscalContext, sessionContext
                );
            }
        }
        
        // Fallback: try to extract from text
        const text = typeof retryResult === 'string' ? retryResult : retryResult.text;
        const parsed = parseAIResponse(text);
        
        if (parsed.query) {
            // Also check for duplicates in text extraction
            const normalizeQuery = (q) => q.replace(/\s+/g, ' ').trim().toLowerCase();
            if (normalizeQuery(parsed.query) === normalizeQuery(failedQuery)) {
                steps[steps.length - 1].status = 'error';
                steps[steps.length - 1].error = 'LLM generated identical query';
                
                const response = ResponseBuilder.buildResponse(
                    'Unable to generate a different query to fix the error.',
                    steps, startTime, AIProviders.getCurrentModelInfo()
                );
                response.sessionContext = sessionContext;
                response.needsReplan = true;
                return response;
            }
            
            steps[steps.length - 1].status = 'complete';
            return executeQueryWithRetries(
                message, history, documents,
                parsed.query,
                parsed.description || 'Retried query',
                steps, startTime, attempt + 1, fiscalContext, sessionContext
            );
        }
        
        // Give up
        steps[steps.length - 1].status = 'error';
        steps[steps.length - 1].error = 'Could not generate valid query after retry';
        
        const response = ResponseBuilder.buildResponse(
            'I was unable to fix the query. Error: ' + error,
            steps,
            startTime,
            AIProviders.getCurrentModelInfo()
        );
        response.sessionContext = sessionContext;
        return response;
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // tryBuildCannedResponse - Skip LLM interpretation for simple template results
    // Returns null if interpretation should proceed normally
    // ═══════════════════════════════════════════════════════════════════════════════
    
    function tryBuildCannedResponse(result, options, description) {
        var templateFormat = options && options.templateFormat;
        var rowCount = result.rowCount || result.rows.length;
        
        // ═══════════════════════════════════════════════════════════════════════════════
        // STRICT: Only use canned responses for SINGLE TRANSACTION CARD lookups
        // Everything else needs LLM interpretation for proper analysis
        // ═══════════════════════════════════════════════════════════════════════════════
        
        // Must have exactly 1 row
        if (rowCount !== 1) {
            return null;
        }
        
        // Must explicitly be a transaction_card template type
        if (!templateFormat || templateFormat.type !== 'transaction_card') {
            return null;
        }
        
        var row = result.rows[0];
        var richContent = [];
        
        // Verify this looks like a transaction (has doc number + entity)
        var entityName = row.vendor_name || row.customer_name || row.entity_name || row.entity || '';
        var docNum = row.document_number || row.tranid || row.id || '';
        
        if (!entityName || !docNum) {
            // Doesn't look like a transaction - let LLM interpret
            return null;
        }
        
        // Determine transaction type for display
        var transactionType = row.trantype || row.type || 'Transaction';
        // Map internal type codes to display names
        var typeNames = {
            'VendBill': 'Vendor Bill',
            'CustInvc': 'Invoice',
            'CustPymt': 'Customer Payment',
            'VendPymt': 'Vendor Payment',
            'SalesOrd': 'Sales Order',
            'PurchOrd': 'Purchase Order',
            'CustCred': 'Credit Memo',
            'VendCred': 'Vendor Credit',
            'Journal': 'Journal Entry',
            'Check': 'Check',
            'Deposit': 'Deposit',
            'Estimate': 'Estimate'
        };
        var displayType = typeNames[transactionType] || transactionType;
        
        // Just the transaction card - no redundant text
        richContent.push({
            type: 'transaction_card',
            title: description || displayType + ' Details',
            transactionType: displayType,
            transaction: row,
            columns: result.columns,
            formatting: templateFormat.formatting || {}
        });
        
        return {
            text: '',
            richContent: richContent,
            blocksFormat: true,
            model: 'Instant',
            provider: 'local',
            _skippedInterpretation: true
        };
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // extractPartialJsonBlocks - Recover valid blocks from truncated JSON array
    // ═══════════════════════════════════════════════════════════════════════════════
    
    function extractPartialJsonBlocks(text) {
        var blocks = [];
        
        try {
            // Clean up the text
            var jsonText = text.trim()
                .replace(/^```(?:json)?\s*/i, '')
                .replace(/\s*```$/i, '')
                .trim();
            
            // Must start with [ to be a JSON array
            if (!jsonText.startsWith('[')) {
                return blocks;
            }
            
            // Try to find complete JSON objects within the array
            // Pattern: {"type": "...", ...} - find each complete object
            var objectPattern = /\{\s*"type"\s*:\s*"([^"]+)"[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g;
            var match;
            
            while ((match = objectPattern.exec(jsonText)) !== null) {
                try {
                    var obj = JSON.parse(match[0]);
                    if (obj && obj.type) {
                        blocks.push(obj);
                    }
                } catch (e) {
                    // This object is malformed, skip it
                    continue;
                }
            }
            
            // If simple pattern didn't work, try finding balanced braces
            if (blocks.length === 0) {
                var depth = 0;
                var start = -1;
                var inString = false;
                var escape = false;
                
                for (var i = 0; i < jsonText.length; i++) {
                    var c = jsonText[i];
                    
                    if (escape) {
                        escape = false;
                        continue;
                    }
                    if (c === '\\') {
                        escape = true;
                        continue;
                    }
                    if (c === '"') {
                        inString = !inString;
                        continue;
                    }
                    if (inString) continue;
                    
                    if (c === '{') {
                        if (depth === 0) start = i;
                        depth++;
                    } else if (c === '}') {
                        depth--;
                        if (depth === 0 && start >= 0) {
                            try {
                                var objStr = jsonText.substring(start, i + 1);
                                var obj = JSON.parse(objStr);
                                if (obj && obj.type) {
                                    blocks.push(obj);
                                }
                            } catch (e) {
                                // Malformed, skip
                            }
                            start = -1;
                        }
                    }
                }
            }
            
            log.debug('Extracted partial JSON blocks', { 
                inputLength: text.length, 
                blocksFound: blocks.length,
                types: blocks.map(function(b) { return b.type; })
            });
            
        } catch (e) {
            log.debug('extractPartialJsonBlocks error', { error: e.message });
        }
        
        return blocks;
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // interpretResults - Updated to use blocks format for interspersed text and rich content
    // ═══════════════════════════════════════════════════════════════════════════════
    function interpretResults(message, description, result, history, documents, fiscalContext, options) {
        options = options || {};
        
        if (!result.rows || result.rows.length === 0) {
            return {
                text: '',
                richContent: [{ type: 'text', content: 'The query returned no results. This might mean there\'s no matching data for the criteria.' }],
                blocksFormat: true
            };
        }
        
        // ═══════════════════════════════════════════════════════════════════════════════
        // OPTIMIZATION: Skip interpretation for simple template results
        // For single-row transaction lookups, canned responses are faster and more reliable
        // ═══════════════════════════════════════════════════════════════════════════════
        
        var cannedResponse = tryBuildCannedResponse(result, options, description);
        if (cannedResponse) {
            log.debug('Using canned response instead of LLM interpretation', {
                rowCount: result.rowCount,
                templateType: options.templateFormat?.type,
                description: description
            });
            return cannedResponse;
        }
        
        fiscalContext = fiscalContext || {};
        
        // Use centralized prompt from Prompts library
        const systemPrompt = Prompts.buildInterpretationPrompt(fiscalContext, message, description);
        
        // Detect if data is suitable for charts
        const hasTimeColumn = result.columns.some(function(c) { return /month|date|period|year|week|quarter/i.test(c); });
        const hasCategoryColumn = result.columns.some(function(c) { return /name|department|customer|vendor|category|type|status|class/i.test(c); });
        const hasNumericColumn = result.columns.some(function(c) { return /amount|total|revenue|count|sum|balance|hours|cost|sales|profit|qty|quantity/i.test(c); });
        const rowCount = result.rowCount || 0;
        
        // Check if user explicitly asked for a chart
        const userWantsChart = /chart|graph|visuali[sz]e|plot|trend|show\s+me/i.test(message);
        
        // Use template chart config if available, otherwise fall back to heuristics
        var chartGuidance = '';
        if (options.templateChart && rowCount >= 2) {
            const tc = options.templateChart;
            var chartProps = 'chartType: "' + tc.type + '", xKey: "' + (tc.xAxis || tc.labelField || 'category') + '", yKey: "' + (tc.yAxis || tc.valueField || tc.series?.[0] || 'value') + '"';
            // Add axis labels if provided
            if (tc.xLabel) chartProps += ', xLabel: "' + tc.xLabel + '"';
            if (tc.yLabel) chartProps += ', yLabel: "' + tc.yLabel + '"';
            // Add yFormat for currency/percent formatting
            if (tc.yFormat === 'currency') chartProps += ', yFormat: "$,.0f"';
            else if (tc.yFormat === 'percent') chartProps += ', yFormat: ",.1%"';
            else if (tc.yFormat) chartProps += ', yFormat: "' + tc.yFormat + '"';
            chartGuidance = '\n🚨 CHART REQUIRED - Include a chart block with ' + chartProps;
        } else if (userWantsChart && rowCount >= 2 && hasNumericColumn) {
            const chartType = hasTimeColumn ? 'line' : 'bar';
            chartGuidance = '\n🚨 USER REQUESTED A CHART - Include a chart block with chartType: "' + chartType + '"';
        } else if (rowCount >= 3 && rowCount <= 20 && hasNumericColumn) {
            if (hasTimeColumn) {
                chartGuidance = '\nCHART RECOMMENDED: Include a line chart to show trends.';
            } else if (hasCategoryColumn) {
                chartGuidance = '\nCHART RECOMMENDED: Include a bar chart to compare categories.';
            }
        }
        
        // Add formatting hints if template provided them
        var formatHints = '';
        if (options.templateFormat && options.templateFormat.formatting) {
            const fmtEntries = [];
            for (var col in options.templateFormat.formatting) {
                if (options.templateFormat.formatting.hasOwnProperty(col)) {
                    fmtEntries.push(col + ': ' + options.templateFormat.formatting[col]);
                }
            }
            formatHints = '\nFORMATTING: Use these formats - ' + fmtEntries.join(', ');
        }
        
        // Send ALL data to LLM for accurate interpretation (use compact format for token efficiency)
        const maxRows = 500;
        const wasTruncated = result.rowCount > maxRows;
        
        var truncationNote = '';
        if (wasTruncated) {
            truncationNote = '\n⚠️ TRUNCATED: Showing ' + maxRows + ' of ' + result.rowCount + ' rows. Mention this limitation in your response.\n';
        }
        
        // Build grand totals info if available
        var grandTotalsInfo = '';
        if (options.grandTotals && Object.keys(options.grandTotals).length > 0) {
            var gtParts = [];
            for (var gtKey in options.grandTotals) {
                if (options.grandTotals.hasOwnProperty(gtKey)) {
                    var gtVal = options.grandTotals[gtKey];
                    var formatted = typeof gtVal === 'number' ? '$' + gtVal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : gtVal;
                    gtParts.push(gtKey.replace('grand_total_', '').replace(/_/g, ' ') + ': ' + formatted);
                }
            }
            grandTotalsInfo = '\n\nPRE-COMPUTED TOTALS: ' + gtParts.join(', ');
        }
        
        const prompt = 'Query: ' + (description || 'Data query') + '\nRows: ' + result.rowCount + ' total\nColumns: ' + result.columns.join(', ') + truncationNote + grandTotalsInfo + '\n\nDATA (' + Math.min(result.rowCount, maxRows) + ' rows):\n' + Utils.formatResultsCompact(result, maxRows, { decimals: 2, truncate: false }) + '\n\nUser asked: "' + message + '"\n\n' +
        '⚠️ YOU MUST call the final_response tool. DO NOT output plain text or raw JSON.\n\n' +
        '🚨 CRITICAL - USE ACTUAL DATA VALUES:\n' +
        '- ALL metrics MUST use EXACT values from the data above\n' +
        '- For totals: SUM the actual values in the data rows (or use PRE-COMPUTED TOTALS if provided)\n' +
        '- For max/min: Find the actual max/min from the data rows\n' +
        '- NEVER make up placeholder values like 125000 or round numbers\n' +
        '- NEVER hallucinate values - only use numbers that appear in the data\n\n' +
        'RESPONSE STRUCTURE:\n' +
        '- Use "metrics" block for key numbers at top (1-3 items with label, value, format: "currency"|"number"|"percent")\n' +
        '- Use "text" block for explanations with specific numbers FROM THE DATA\n' +
        '- Use "chart" block if data is suitable - MUST include inline "data" array, NEVER use resultRef\n' +
        '- Use "callout" with variant:"warning" for concerns\n' +
        '- DO NOT include table block - tables are auto-added\n\n' +
        '🚨 CHART DATA REQUIREMENT:\n' +
        'Charts MUST include a "data" array with the actual values. Example:\n' +
        '{ "type": "chart", "chartType": "line", "title": "Revenue Trend", "xKey": "month", "yKey": "revenue", "data": [{"month": "Jan", "revenue": 1000}, {"month": "Feb", "revenue": 1200}] }\n' +
        'NEVER use resultRef - always embed the data directly in the chart block.\n' + chartGuidance + formatHints;

        try {
            const aiResult = AIProviders.callAI(prompt, { 
                temperature: 0.2,
                systemPrompt: systemPrompt,
                purpose: 'Interpret query results',
                tier: 3,
                tools: [ToolDefinitions.FINAL_RESPONSE_TOOL]
            });
            
            // Handle tool call response
            let blocks = [];
            if (aiResult.type === 'tool_call' && aiResult.toolCalls && aiResult.toolCalls.length > 0) {
                const toolCall = aiResult.toolCalls.find(tc => tc && tc.name === 'final_response');
                if (toolCall && toolCall.arguments) {
                    const args = typeof toolCall.arguments === 'string' 
                        ? JSON.parse(toolCall.arguments) 
                        : toolCall.arguments;
                    blocks = args.blocks || [];
                }
            }
            
            // Fallback: try to parse from text response
            if (blocks.length === 0) {
                const fullText = typeof aiResult === 'string' ? aiResult : aiResult.text;
                if (fullText) {
                    // Use Utils.extractAndRemoveJson for proper JSON extraction
                    const extracted = Utils.extractAndRemoveJson(fullText, 'type');
                    
                    // Try to parse blocks array
                    try {
                        let jsonText = fullText.trim();
                        jsonText = jsonText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
                        const parsed = JSON.parse(jsonText);
                        if (Array.isArray(parsed)) {
                            blocks = parsed;
                        } else if (parsed.blocks && Array.isArray(parsed.blocks)) {
                            blocks = parsed.blocks;
                        }
                    } catch (parseErr) {
                        // If JSON parse fails, try legacy parser with cleaned text
                        log.debug('Blocks parse failed, using fallback', { error: parseErr.message });
                        const richContent = ResponseBuilder.parseRichContentFromAI(fullText, result, description, message);
                        
                        // Convert to blocks format
                        const metrics = richContent.filter(r => r.type === 'metric' || r.type === 'metrics');
                        const charts = richContent.filter(r => r.type === 'chart');
                        const others = richContent.filter(r => r.type !== 'metric' && r.type !== 'metrics' && r.type !== 'chart' && r.type !== 'table');
                        
                        if (metrics.length > 0) {
                            blocks.push({ type: 'metrics', items: metrics.map(m => m.items ? m.items : [{ label: m.label, value: m.value, format: m.format }]).flat() });
                        }
                        // Add text if we have cleaned content
                        if (extracted.cleanedText && extracted.cleanedText.length > 10) {
                            blocks.push({ type: 'text', content: extracted.cleanedText });
                        }
                        blocks = blocks.concat(charts);
                        blocks = blocks.concat(others);
                    }
                }
            }
            
            // Ensure we have at least one text block
            if (!blocks.some(b => b.type === 'text')) {
                blocks.push({ type: 'text', content: 'Here are the query results:' });
            }
            
            // Auto-add table at the end (if more than 1 row, otherwise transaction card logic applies elsewhere)
            if (result.rows.length > 1) {
                // Safety limit: 5000 rows max to prevent memory issues
                // No artificial limits - let the data flow unless it exceeds safety threshold
                var SAFETY_ROW_LIMIT = 5000;
                var rowLimit = SAFETY_ROW_LIMIT;
                
                var tableConfig = {
                    type: 'table',
                    title: description || 'Query Results',
                    columns: result.columns,
                    rows: result.rows.slice(0, rowLimit)
                };
                
                // Apply template formatting if available (groupBy, variant, etc.)
                if (options.templateFormat) {
                    // Apply pivot transformation FIRST if enabled (transforms rows/columns)
                    var pivotWasApplied = false;
                    var pivotedColumnValues = []; // Store the new column names from pivoting
                    if (options.templateFormat.pivotConfig && options.templateFormat.pivotConfig.enabled) {
                        var pivotResult = Utils.applyPivotTransformation(result.rows, result.columns, options.templateFormat.pivotConfig);
                        if (pivotResult.pivotApplied) {
                            tableConfig.rows = pivotResult.rows.slice(0, rowLimit);
                            tableConfig.columns = pivotResult.columns;
                            pivotWasApplied = true;
                            
                            // Extract the new pivot column names (department names, Total, etc.)
                            // These are the columns that weren't in the original but are now numeric
                            var originalCols = {};
                            result.columns.forEach(function(c) { originalCols[c] = true; });
                            pivotResult.columns.forEach(function(c) {
                                if (!originalCols[c]) {
                                    pivotedColumnValues.push(c);
                                }
                            });
                            
                            // Use rowGroupField for grouping in pivoted view
                            if (pivotResult.groupBy) {
                                tableConfig.groupBy = pivotResult.groupBy;
                            }
                            tableConfig.showSubtotals = true;
                            log.debug('Applied pivot transformation in interpretResults', {
                                originalRows: result.rows.length,
                                pivotedRows: pivotResult.rows.length,
                                pivotedColumns: pivotResult.columns.length,
                                newPivotColumns: pivotedColumnValues
                            });
                        }
                        // Pass pivotConfig to frontend BUT mark as already applied
                        tableConfig.pivotConfig = Object.assign({}, options.templateFormat.pivotConfig, {
                            prePivoted: true  // Signal to client that data is already pivoted
                        });
                    }
                    
                    // Copy groupBy for grouped tables (only if not already set by pivot)
                    if (options.templateFormat.groupBy && !tableConfig.groupBy) {
                        tableConfig.groupBy = options.templateFormat.groupBy;
                        tableConfig.showSubtotals = options.templateFormat.showSubtotals !== false;
                    }
                    
                    // Set variant - use income_statement for pivoted financial statements
                    if (pivotWasApplied && options.templateFormat.calculatedTotals) {
                        // Pivoted data with calculated totals = income statement format
                        tableConfig.variant = 'income_statement';
                    } else if (options.templateFormat.variant) {
                        tableConfig.variant = options.templateFormat.variant;
                    }
                    if (options.templateFormat.sections) {
                        tableConfig.sections = options.templateFormat.sections;
                        tableConfig.variant = 'financial_statement';
                    }
                    
                    // Set formatting - if pivoted, apply currency to new pivot columns
                    if (pivotWasApplied && pivotedColumnValues.length > 0) {
                        // Build formatting for the new pivot columns
                        var pivotFormatting = {};
                        pivotedColumnValues.forEach(function(col) {
                            pivotFormatting[col] = 'currency';
                        });
                        // Also lowercase versions for matching
                        pivotedColumnValues.forEach(function(col) {
                            pivotFormatting[col.toLowerCase()] = 'currency';
                        });
                        tableConfig.formatting = pivotFormatting;
                    } else if (options.templateFormat.formatting) {
                        tableConfig.formatting = options.templateFormat.formatting;
                    }
                    if (options.templateFormat.showTotal) {
                        tableConfig.showGrandTotal = true;
                    }
                    // Copy calculatedTotals for P&L-style computed rows (Gross Profit, Net Income)
                    if (options.templateFormat.calculatedTotals) {
                        tableConfig.calculatedTotals = options.templateFormat.calculatedTotals;
                    }
                    // Copy hideGroupColumn setting
                    if (options.templateFormat.hideGroupColumn !== undefined) {
                        tableConfig.hideGroupColumn = options.templateFormat.hideGroupColumn;
                    }
                }
                
                blocks.push(tableConfig);
            }
            
            return {
                text: '',  // Empty - all content is in blocks
                richContent: blocks,
                blocksFormat: true,
                model: aiResult.model,
                provider: aiResult.provider
            };
            
        } catch (e) {
            log.debug('Interpretation error', { error: e.message });
            
            // Safety limit: 5000 rows max
            var SAFETY_ROW_LIMIT = 5000;
            var fallbackRowLimit = SAFETY_ROW_LIMIT;
            
            // Build table config even in error case
            var fallbackTableConfig = {
                type: 'table',
                title: description || 'Results',
                columns: result.columns,
                rows: result.rows.slice(0, fallbackRowLimit)
            };
            
            // Apply template formatting even in fallback (groupBy, variant, pivotConfig, etc.)
            if (options && options.templateFormat) {
                // Apply pivot transformation FIRST if enabled
                var fallbackPivotApplied = false;
                var fallbackPivotColumns = [];
                if (options.templateFormat.pivotConfig && options.templateFormat.pivotConfig.enabled) {
                    var pivotResult = Utils.applyPivotTransformation(result.rows, result.columns, options.templateFormat.pivotConfig);
                    if (pivotResult.pivotApplied) {
                        fallbackTableConfig.rows = pivotResult.rows.slice(0, fallbackRowLimit);
                        fallbackTableConfig.columns = pivotResult.columns;
                        fallbackPivotApplied = true;
                        
                        // Extract new pivot column names
                        var origCols = {};
                        result.columns.forEach(function(c) { origCols[c] = true; });
                        pivotResult.columns.forEach(function(c) {
                            if (!origCols[c]) {
                                fallbackPivotColumns.push(c);
                            }
                        });
                        
                        if (pivotResult.groupBy) {
                            fallbackTableConfig.groupBy = pivotResult.groupBy;
                        }
                        fallbackTableConfig.showSubtotals = true;
                    }
                    fallbackTableConfig.pivotConfig = Object.assign({}, options.templateFormat.pivotConfig, {
                        prePivoted: true
                    });
                }
                
                // Copy groupBy (only if not already set by pivot)
                if (options.templateFormat.groupBy && !fallbackTableConfig.groupBy) {
                    fallbackTableConfig.groupBy = options.templateFormat.groupBy;
                    fallbackTableConfig.showSubtotals = options.templateFormat.showSubtotals !== false;
                }
                
                // Set variant - use income_statement for pivoted financial statements
                if (fallbackPivotApplied && options.templateFormat.calculatedTotals) {
                    fallbackTableConfig.variant = 'income_statement';
                } else if (options.templateFormat.variant) {
                    fallbackTableConfig.variant = options.templateFormat.variant;
                }
                if (options.templateFormat.sections) {
                    fallbackTableConfig.sections = options.templateFormat.sections;
                    fallbackTableConfig.variant = 'financial_statement';
                }
                
                // Set formatting - if pivoted, apply currency to new pivot columns
                if (fallbackPivotApplied && fallbackPivotColumns.length > 0) {
                    var fbFormatting = {};
                    fallbackPivotColumns.forEach(function(col) {
                        fbFormatting[col] = 'currency';
                        fbFormatting[col.toLowerCase()] = 'currency';
                    });
                    fallbackTableConfig.formatting = fbFormatting;
                } else if (options.templateFormat.formatting) {
                    fallbackTableConfig.formatting = options.templateFormat.formatting;
                }
                // Copy calculatedTotals for P&L-style computed rows
                if (options.templateFormat.calculatedTotals) {
                    fallbackTableConfig.calculatedTotals = options.templateFormat.calculatedTotals;
                }
                // Copy hideGroupColumn setting
                if (options.templateFormat.hideGroupColumn !== undefined) {
                    fallbackTableConfig.hideGroupColumn = options.templateFormat.hideGroupColumn;
                }
            }
            
            return {
                text: '',
                richContent: [
                    { type: 'text', content: 'Found ' + result.rowCount + ' results for ' + (description || 'your query') + ':' },
                    fallbackTableConfig
                ],
                blocksFormat: true
            };
        }
    }
    
    // NOTE: parseRichContentFromAI, parseRichContentCore, sortRichContent,
    // isSingleTransactionResult, buildTransactionCardData, detectTransactionType,
    // buildChartDataFromResult removed - use ResponseBuilder versions

    // ═══════════════════════════════════════════════════════════════════════════════
    // generateQueryWithAI - EXACT copy from original line 5330
    // ═══════════════════════════════════════════════════════════════════════════════
    function generateQueryWithAI(message, history, documents, fiscalContext, sqlHint) {
        // Use centralized prompt from Prompts library
        const systemPrompt = Prompts.buildQueryGenerationPrompt(fiscalContext, sqlHint);

        const userPrompt = 'Question: ' + message;

        try {
            // Try tool calling first (more reliable, structured output)
            const result = AIProviders.callAI(userPrompt, { 
                maxTokens: DEFAULT_MAX_TOKENS,
                temperature: 0.2,
                systemPrompt: systemPrompt,
                chatHistory: history,
                documents: documents,
                tools: [SUITEQL_TOOL],
                purpose: 'Generate SQL query',
                tier: 2  // Use balanced model for SQL generation
            });
            
            // Handle tool call response
            if (result.type === 'tool_call' && result.toolCalls && result.toolCalls.length > 0) {
                const toolCall = result.toolCalls[0];
                if (toolCall.name === 'execute_suiteql') {
                    return {
                        success: true,
                        query: toolCall.arguments.query,
                        description: toolCall.arguments.description,
                        model: result.model
                    };
                }
            }
            
            // Fallback: Parse from text
            const text = typeof result === 'string' ? result : result.text;
            const parsed = parseAIResponse(text);
            
            if (parsed.query) {
                return {
                    success: true,
                    query: parsed.query,
                    description: parsed.description || 'Generated query',
                    model: result.model
                };
            }
            
            return {
                success: false,
                error: 'Could not extract query from AI response',
                model: result.model
            };
            
        } catch (e) {
            log.error('Query generation failed', { error: e.message });
            return {
                success: false,
                error: e.message
            };
        }
    }
    
    // ═══════════════════════════════════════════════════════════════════════════════
    // parseAIResponse - EXACT copy from original line 5403
    // ═══════════════════════════════════════════════════════════════════════════════
    function parseAIResponse(text) {
        if (!text) return {};
        
        // Try to extract SQL from various formats
        var query = null;
        var description = null;
        
        // Look for SQL in code blocks
        const codeBlockMatch = text.match(/```(?:sql)?\s*(SELECT[\s\S]*?)```/i);
        if (codeBlockMatch) {
            query = codeBlockMatch[1].trim();
        }
        
        // Look for bare SELECT statement
        if (!query) {
            const selectMatch = text.match(/SELECT[\s\S]*?(?=;|$)/i);
            if (selectMatch) {
                query = selectMatch[0].trim();
            }
        }
        
        // Try to extract description
        const descMatch = text.match(/description[:\s]*["']?([^"'\n]+)["']?/i);
        if (descMatch) {
            description = descMatch[1].trim();
        }
        
        // Clean the query
        if (query) {
            query = Utils.cleanQuery(query);
        }
        
        return {
            query: query,
            description: description
        };
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // buildQueryFromTemplate - EXACT copy from original line 4609
    // ═══════════════════════════════════════════════════════════════════════════════
    function buildQueryFromTemplate(template, params, fiscalContext) {
        var sql = template.sql || template.query;
        
        if (!sql) {
            throw new Error('Template "' + (template.id || template.name) + '" has no sql/query property');
        }
        
        params = params || {};
        
        // Add fiscal context to params
        if (fiscalContext) {
            params.currentDate = fiscalContext.currentDate;
            params.fiscalYearStart = fiscalContext.fiscalYearStart;
            params.fiscalYearEnd = fiscalContext.fiscalYearEnd;
            params.currentYear = fiscalContext.currentYear;
            params.currentMonth = fiscalContext.currentMonth;
            
            // Calculate YTD comparison dates for comparative templates
            // Current period: fiscal year start to today
            params.currentPeriodStart = params.currentPeriodStart || fiscalContext.fiscalYearStart;
            params.currentPeriodEnd = params.currentPeriodEnd || fiscalContext.currentDate;
            
            // Prior period: same period last year (YTD to YTD comparison)
            // Calculate by subtracting 1 year from current period dates
            var yearsBack = parseInt(params.years_back) || 1;
            
            if (!params.priorPeriodStart || !params.priorPeriodEnd) {
                var currentStart = new Date(params.currentPeriodStart);
                var currentEnd = new Date(params.currentPeriodEnd);
                
                // Subtract years
                var priorStart = new Date(currentStart);
                priorStart.setFullYear(priorStart.getFullYear() - yearsBack);
                
                var priorEnd = new Date(currentEnd);
                priorEnd.setFullYear(priorEnd.getFullYear() - yearsBack);
                
                params.priorPeriodStart = params.priorPeriodStart || Utils.formatDateYMD(priorStart);
                params.priorPeriodEnd = params.priorPeriodEnd || Utils.formatDateYMD(priorEnd);
            }
            
            // Also provide prior fiscal year dates for templates that need full year comparison
            var fyStart = new Date(fiscalContext.fiscalYearStart);
            var priorFyStart = new Date(fyStart);
            priorFyStart.setFullYear(priorFyStart.getFullYear() - yearsBack);
            var priorFyEnd = new Date(fyStart);
            priorFyEnd.setDate(priorFyEnd.getDate() - 1); // Day before current FY start
            
            params.priorFiscalYearStart = params.priorFiscalYearStart || Utils.formatDateYMD(priorFyStart);
            params.priorFiscalYearEnd = params.priorFiscalYearEnd || Utils.formatDateYMD(priorFyEnd);
        }
        
        // Handle entity filter placeholders
        // These are conditional WHERE clauses that only apply if an entity ID is provided
        if (params.vendorId) {
            params.vendorFilter = 'AND vendor.id = ' + parseInt(params.vendorId, 10);
        } else {
            params.vendorFilter = '';
        }
        
        if (params.customerId) {
            params.customerFilter = 'AND customer.id = ' + parseInt(params.customerId, 10);
        } else {
            params.customerFilter = '';
        }
        
        if (params.employeeId) {
            params.employeeFilter = 'AND employee.id = ' + parseInt(params.employeeId, 10);
        } else {
            params.employeeFilter = '';
        }
        
        if (params.departmentId) {
            params.departmentFilter = 'AND department.id = ' + parseInt(params.departmentId, 10);
        } else {
            params.departmentFilter = '';
        }
        
        if (params.projectId) {
            params.projectFilter = 'AND project.id = ' + parseInt(params.projectId, 10);
        } else {
            params.projectFilter = '';
        }
        
        // Replace {param} placeholders with SQL-escaped values
        // CRITICAL: Templates handle quoting (surrounding '...'), but we MUST escape 
        // single quotes inside values to prevent SQL injection (convert ' → '')
        sql = sql.replace(/\{(\w+)\}/g, function(match, paramName) {
            if (params.hasOwnProperty(paramName) && params[paramName] !== undefined && params[paramName] !== null) {
                var value = String(params[paramName]);
                // Escape single quotes for SQL injection prevention
                // This converts: O'Brien → O''Brien (SQL standard escaping)
                value = value.replace(/'/g, "''");
                return value;
            }
            // Keep placeholder if param not found
            return match;
        });
        
        return sql;
    }
    
    // NOTE: formatDateYMD removed - use Utils.formatDateYMD

    // ═══════════════════════════════════════════════════════════════════════════════
    // executeTemplate - EXACT copy from original line 3328
    // ═══════════════════════════════════════════════════════════════════════════════
    function executeTemplate(templateId, params, fiscalContext) {
        const template = Templates.getTemplate(templateId);
        if (!template) {
            return {
                success: false,
                error: 'Template not found: ' + templateId
            };
        }
        
        // Build the query
        const query = buildQueryFromTemplate(template, params, fiscalContext);
        
        // Execute
        const result = QueryExecutor.executeQuery(query);
        
        if (!result.success) {
            return {
                success: false,
                error: result.error,
                templateId: templateId,
                executedSql: query
            };
        }
        
        // Provide guidance if zero rows but query succeeded
        var zeroRowGuidance = null;
        if (result.rowCount === 0 && template.zeroRowGuidance) {
            zeroRowGuidance = template.zeroRowGuidance;
        }
        
        return {
            success: true,
            rows: result.rows,
            columns: result.columns,
            rowCount: result.rowCount,
            templateId: templateId,
            templateName: template.name,
            executedSql: query,
            zeroRowGuidance: zeroRowGuidance
        };
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // buildRAGDocuments - EXACT copy from original line 4745
    // ═══════════════════════════════════════════════════════════════════════════════
    function buildRAGDocuments(fiscalContext) {
        const documents = [];
        const templates = Templates.TEMPLATES;
        
        // Create a document for each template category
        const categories = {};
        templates.forEach(function(t) {
            if (!categories[t.category]) {
                categories[t.category] = [];
            }
            categories[t.category].push(t);
        });
        
        // Create documents for key categories
        Object.keys(categories).forEach(function(cat, idx) {
            var catTemplates = categories[cat];
            var content = 'CATEGORY: ' + cat + '\n\n';
            
            catTemplates.forEach(function(t) {
                content += '--- ' + t.name + ' ---\n';
                content += 'Use for: ' + t.description + '\n';
                if (t.parameters && t.parameters.length > 0) {
                    content += 'Parameters: ' + t.parameters.map(function(p) { return p.name; }).join(', ') + '\n';
                }
                content += '\n';
            });
            
            try {
                documents.push(llm.createDocument({
                    id: 'templates_' + cat.toLowerCase().replace(/\s+/g, '_') + '_' + idx,
                    data: content
                }));
            } catch (e) {
                log.debug('Failed to create template doc', { cat: cat, error: e.message });
            }
        });
        
        // Add schema document
        try {
            documents.push(llm.createDocument({
                id: 'schema',
                data: getSchemaDoc(fiscalContext)
            }));
        } catch (e) {
            log.debug('Failed to create schema doc', { error: e.message });
        }
        
        return documents;
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // getSchemaDoc - EXACT copy from original line 4795
    // ═══════════════════════════════════════════════════════════════════════════════
    function getSchemaDoc(fiscal) {
        fiscal = fiscal || {};
        
        return 'NETSUITE SUITEQL SCHEMA REFERENCE\n\nCURRENT DATE & FISCAL CONTEXT:\n- Today\'s date: ' + (fiscal.currentDate || new Date().toISOString().split('T')[0]) + '\n- Current calendar year: ' + (fiscal.currentYear || new Date().getFullYear()) + '\n- Current period: ' + (fiscal.currentPeriod || 'Unknown') + '\n- Fiscal year: ' + (fiscal.fiscalYearName || 'FY' + fiscal.currentYear) + '\n- Fiscal year start: ' + fiscal.fiscalYearStart + '\n- Fiscal year end: ' + fiscal.fiscalYearEnd + '\n\nIMPORTANT DATE FILTERING:\n- For FISCAL YTD: transaction.trandate >= TO_DATE(\'' + fiscal.fiscalYearStart + '\', \'YYYY-MM-DD\')\n- For calendar YTD: transaction.trandate >= TRUNC(CURRENT_DATE, \'YEAR\')\n- When user says "YTD", "this year", "year to date" = use FISCAL year start\n- Last N months: transaction.trandate >= ADD_MONTHS(CURRENT_DATE, -N)\n\nTABLES AND KEY FIELDS:\n\ntransaction (header level):\n- id, trandate, type, posting, entity, foreigntotal, status, subsidiary, tranid\n- Types: CustInvc (Invoice), CashSale, CustPymt (Payment), VendBill, VendPymt, Journal\n- foreigntotal: ONLY use when NOT joining transactionline\n\ntransactionline (line items - MUST JOIN to transaction):\n- transaction (FK to transaction.id), item, quantity, rate\n- netamount: Line amount (NEGATIVE for revenue credits - multiply by -1)\n- amount: Alternative line amount field\n- department, class, location, entity - These are ID fields!\n- mainline: Use \'F\' to get actual line items, \'T\' is just the header summary\n- JOIN: INNER JOIN transactionline ON transactionline.transaction = transaction.id\n\ndepartment table (for filtering by name):\n- id, name\n- JOIN: INNER JOIN department ON transactionline.department = department.id\n\ncustomer/vendor tables:\n- id, companyname, entityid\n- JOIN: INNER JOIN customer ON transaction.entity = customer.id\n\naccount:\n- id, acctnumber, accttype (use BUILTIN.DF(account.id) for name)\n\nitem:\n- id, itemid, displayname, itemtype\n\nREVENUE QUERIES (negative netamount):\nSELECT d.name as department, SUM(-tl.netamount) as revenue\nFROM transaction t\nINNER JOIN transactionline tl ON tl.transaction = t.id\nINNER JOIN department d ON tl.department = d.id\nWHERE t.type IN (\'CustInvc\', \'CashSale\')\n  AND t.posting = \'T\'\n  AND tl.mainline = \'F\'\n  AND t.trandate >= TO_DATE(\'' + fiscal.fiscalYearStart + '\', \'YYYY-MM-DD\')\nGROUP BY d.name\n\nEXPENSE QUERIES (positive netamount):\nUse t.type = \'VendBill\' and tl.netamount (positive for expenses)\n\nJOINS ARE CRITICAL:\n- Always use INNER JOIN for related tables\n- department, class, location fields are IDs - join to get names\n- entity field is ID - join to customer or vendor table for names';
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // EXPORTS
    // ═══════════════════════════════════════════════════════════════════════════════
    
    // ═══════════════════════════════════════════════════════════════════════════════
    // synthesizeMultiTemplateResults - LLM synthesis for multi-template queries
    // Interprets multiple result sets together to produce unified insights
    // ═══════════════════════════════════════════════════════════════════════════════
    function synthesizeMultiTemplateResults(message, allResults, synthesisInstructions, fiscalContext) {
        var debugInfo = {
            startTime: Date.now(),
            inputResults: allResults.length,
            synthesisInstructions: synthesisInstructions
        };
        
        try {
            // Build a compact data summary for the LLM
            var dataSummary = allResults.map(function(r) {
                var preview = '';
                if (r.rows && r.rows.length > 0) {
                    // Include first few rows as sample
                    var sampleRows = r.rows.slice(0, 10);
                    preview = '\nSample data (' + r.rowCount + ' total rows):\n';
                    preview += 'Columns: ' + r.columns.join(', ') + '\n';
                    sampleRows.forEach(function(row, i) {
                        var rowValues = r.columns.map(function(col) {
                            var key = col.toLowerCase().replace(/[^a-z0-9]/g, '_');
                            var val = row[key] !== undefined ? row[key] : row[col];
                            if (typeof val === 'number') {
                                return val.toLocaleString();
                            }
                            return val || '';
                        });
                        preview += '  ' + rowValues.join(' | ') + '\n';
                    });
                    if (r.rowCount > 10) {
                        preview += '  ... and ' + (r.rowCount - 10) + ' more rows\n';
                    }
                } else {
                    preview = '\n(No data returned)';
                }
                return '=== ' + r.templateName + ' ===\nPurpose: ' + r.purpose + preview;
            }).join('\n\n');
            
            var prompt = 'You are a financial analyst synthesizing data from multiple queries.\n\n';
            prompt += 'ORIGINAL QUESTION: ' + message + '\n\n';
            prompt += 'SYNTHESIS INSTRUCTIONS: ' + (synthesisInstructions || 'Combine the results and provide key insights.') + '\n\n';
            prompt += 'DATA FROM QUERIES:\n' + dataSummary + '\n\n';
            prompt += 'Respond with a JSON object:\n';
            prompt += '{\n';
            prompt += '  "summary": "A 2-3 sentence executive summary answering the user\'s question",\n';
            prompt += '  "insights": ["insight 1", "insight 2", "insight 3"]  // 3-5 specific, data-driven insights\n';
            prompt += '}\n\n';
            prompt += 'Be specific with numbers and percentages. Focus on what the data reveals.';
            
            debugInfo.promptLength = prompt.length;
            debugInfo.dataSummaryLength = dataSummary.length;
            log.debug('Synthesis prompt', { promptLength: prompt.length });
            
            // Try synthesis with retry on failure - limit to 1 retry (2 attempts max, ~25s)
            var result = null;
            var maxRetries = 1;
            var retryCount = 0;
            
            while (retryCount <= maxRetries) {
                result = AIProviders.callAI(prompt, {
                    temperature: 0.3,
                    maxTokens: 1000,
                    purpose: 'Synthesize multi-step results',
                    tier: retryCount === 0 ? 2 : 1  // Fallback to faster tier on retry
                });
                
                // FIX: callAI returns {text, type, error} not {success}
                // Check for valid response: has text and is not an error type
                var isSuccess = result && result.text && result.type !== 'error' && !result.error;
                
                if (isSuccess) {
                    break;
                }
                
                retryCount++;
                debugInfo['retry' + retryCount] = {
                    error: result ? (result.error || 'Empty response') : 'No result',
                    timestamp: Date.now()
                };
                log.debug('Synthesis retry', { attempt: retryCount, error: result ? result.error : 'null result' });
            }
            
            // Check final result
            var finalSuccess = result && result.text && result.type !== 'error' && !result.error;
            debugInfo.aiCallSuccess = finalSuccess;
            debugInfo.aiCallDuration = Date.now() - debugInfo.startTime;
            debugInfo.retryCount = retryCount;
            
            if (!finalSuccess) {
                debugInfo.errorType = 'ai_call_failed';
                debugInfo.aiError = result ? (result.error || 'Empty or error response') : 'No result';
                log.debug('Synthesis LLM call failed after retries', { error: debugInfo.aiError, debugInfo: debugInfo });
                return { success: false, error: debugInfo.aiError, _debugInfo: debugInfo };
            }
            
            debugInfo.responseLength = result.text ? result.text.length : 0;
            debugInfo.responsePreview = result.text ? result.text.substring(0, 200) : '';
            
            // Parse the response
            var parsed = Utils.extractJsonFromText(result.text, 'summary');
            debugInfo.parsedSuccess = !!parsed;
            debugInfo.hasSummary = !!(parsed && parsed.summary);
            
            if (parsed && parsed.summary) {
                log.debug('Synthesis successful', { summaryLength: parsed.summary.length, insightCount: (parsed.insights || []).length });
                return {
                    success: true,
                    summary: parsed.summary,
                    insights: parsed.insights || [],
                    model: result.model,
                    provider: result.provider,
                    _debugInfo: debugInfo
                };
            }
            
            // Fallback: use raw text as summary
            debugInfo.usedFallback = true;
            log.debug('Synthesis using fallback (raw text)', { textLength: result.text.length });
            return {
                success: true,
                summary: result.text,
                insights: [],
                model: result.model,
                provider: result.provider,
                _debugInfo: debugInfo
            };
            
        } catch (e) {
            debugInfo.errorType = 'exception';
            debugInfo.exceptionMessage = e.message;
            debugInfo.exceptionStack = e.stack;
            log.error('Synthesis error', { message: e.message, debugInfo: debugInfo });
            return { success: false, error: e.message, _debugInfo: debugInfo };
        }
    }

    return {
        // Main execution
        executeQueryWithRetries: executeQueryWithRetries,
        generateQueryWithAI: generateQueryWithAI,
        
        // Template execution
        executeTemplate: executeTemplate,
        buildQueryFromTemplate: buildQueryFromTemplate,
        
        // RAG/Schema
        buildRAGDocuments: buildRAGDocuments,
        getSchemaDoc: getSchemaDoc,
        
        // Response interpretation
        interpretResults: interpretResults,
        synthesizeMultiTemplateResults: synthesizeMultiTemplateResults,
        // Re-export from ResponseBuilder for backwards compatibility
        parseRichContentFromAI: ResponseBuilder.parseRichContentFromAI,
        parseRichContentCore: ResponseBuilder.parseRichContentCore,
        sortRichContent: ResponseBuilder.sortRichContent,
        
        // Transaction detection - re-export from ResponseBuilder
        isSingleTransactionResult: ResponseBuilder.isSingleTransactionResult,
        buildTransactionCardData: ResponseBuilder.buildTransactionCardData,
        detectTransactionType: ResponseBuilder.detectTransactionType,
        buildChartDataFromResult: ResponseBuilder.buildChartDataFromResult,
        
        // Query parsing
        parseAIResponse: parseAIResponse,
        
        // Formatting
        applyTemplateFormatting: applyTemplateFormatting,
        // Re-export from Utils for backwards compatibility
        extractTopicsFromQuery: Utils.extractTopicsFromQuery,
        
        // Retry
        retryWithError: retryWithError,
        
        // Tools
        SUITEQL_TOOL: SUITEQL_TOOL,
        
        // Constants
        MAX_RETRIES: MAX_RETRIES
    };
});