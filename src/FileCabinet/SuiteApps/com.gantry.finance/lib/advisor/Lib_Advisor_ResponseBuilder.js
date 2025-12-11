/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * 
 * Lib_Advisor_ResponseBuilder.js
 * Response building and rich content for the Advisor module
 * 
 * Contains:
 * - buildResponse
 * - buildAgentResponse
 * - buildFallbackResponse
 * - Rich content parsing
 * - Transaction card building
 * - Markdown table extraction
 */
define(['N/log', './Lib_Advisor_Utils', './Lib_Advisor_AIProviders', '../Lib_Dashboard_Registry'], function(log, Utils, AIProviders, DashboardRegistry) {
    'use strict';

    /**
     * Build final response object with common structure
     * EXACT copy from original line 6206
     */
    function buildResponse(text, steps, startTime, options) {
        options = options || {};
        
        // Get AI call log and add to steps
        var aiCalls = AIProviders.getAndClearAICallLog();
        if (aiCalls.length > 0) {
            // Add a summary step for AI calls
            var totalDuration = aiCalls.reduce(function(sum, c) { return sum + (c.duration || 0); }, 0);
            steps.push({
                type: 'llm_calls',
                title: aiCalls.length + ' LLM call' + (aiCalls.length > 1 ? 's' : '') + ' (' + Math.round(totalDuration / 1000) + 's)',
                calls: aiCalls,
                status: 'complete',
                timestamp: Date.now()
            });
        }
        
        // Extract markdown tables from text and convert to richContent
        var extracted = extractMarkdownTables(text);
        const cleanText = extracted.text;
        const extractedTables = extracted.tables;
        
        const response = {
            text: cleanText || '',
            steps: steps,
            duration: Date.now() - startTime
        };
        
        // Include model info if available
        if (options.model) {
            response.model = options.model;
        }
        if (options.provider) {
            response.provider = options.provider;
        }
        
        // Include rich content (metrics, charts, tables) if available
        if (options.richContent && options.richContent.length > 0) {
            response.richContent = options.richContent;
        } else {
            response.richContent = [];
        }
        
        // Add extracted markdown tables as richContent
        if (extractedTables.length > 0) {
            extractedTables.forEach(table => {
                response.richContent.push(table);
            });
        }
        
        // Include follow-up suggestions if available
        if (options.followUpSuggestions && options.followUpSuggestions.length > 0) {
            response.followUpSuggestions = options.followUpSuggestions;
        } else if (options.sessionContext || options.context || options.dashboardContext) {
            // Merge dashboard context with session context for suggestions
            let mergedContext = options.sessionContext || options.context || {};
            if (options.dashboardContext) {
                mergedContext = Object.assign({}, mergedContext, options.dashboardContext);
            }
            // Generate contextual suggestions based on session data (no LLM call needed)
            const contextualSuggestions = generateContextualSuggestions(mergedContext);
            if (contextualSuggestions.length > 0) {
                response.followUpSuggestions = contextualSuggestions;
            }
        }
        
        // Include conversation context for follow-ups (resolved entities, previous query info)
        if (options.context) {
            response.context = options.context;
        }
        
        return response;
    }
    
    /**
     * Generate contextual follow-up suggestions based on session data
     * Zero-cost (no LLM call) - uses pattern matching on topics and entities
     */
    function generateContextualSuggestions(sessionContext) {
        if (!sessionContext) return [];
        
        const suggestions = [];
        const topics = sessionContext.topics || [];
        const entities = sessionContext.resolvedEntities || {};
        const templateFormat = sessionContext.templateFormat || {};
        const dashboardId = sessionContext.dashboardId;
        
        // Get first resolved entity for context
        const entityNames = Object.keys(entities);
        const firstEntity = entityNames.length > 0 ? entities[entityNames[0]] : null;
        const entityName = firstEntity ? firstEntity.name : null;
        const entityType = firstEntity ? firstEntity.type : null;
        
        // Dashboard-specific suggestions from Registry (highest priority - single source of truth)
        if (dashboardId) {
            const dashboardSuggestions = DashboardRegistry.getDashboardSuggestions(dashboardId);
            if (dashboardSuggestions && dashboardSuggestions.length > 0) {
                return dashboardSuggestions;
            }
        }
        
        // Topic-based suggestions
        if (topics.includes('vendors') || topics.includes('bills') || entityType === 'vendor') {
            if (entityName) {
                suggestions.push(`Show all bills from ${entityName} this year`);
                suggestions.push(`Compare ${entityName} spending to last year`);
            } else {
                suggestions.push('Who are our top 10 vendors by spend?');
                suggestions.push('Show aging payables by vendor');
            }
        }
        
        if (topics.includes('customers') || topics.includes('invoices') || entityType === 'customer') {
            if (entityName) {
                suggestions.push(`Show open invoices for ${entityName}`);
                suggestions.push(`${entityName} sales this year vs last year`);
            } else {
                suggestions.push('Who are our top customers by revenue?');
                suggestions.push('Show aging receivables by customer');
            }
        }
        
        if (topics.includes('transactions') || topics.includes('payments') || topics.includes('cash')) {
            suggestions.push('Show recent large transactions over $10,000');
            suggestions.push('What payments are due this week?');
        }
        
        if (topics.includes('revenue') || topics.includes('sales') || topics.includes('profit')) {
            suggestions.push('Revenue by month for this year');
            suggestions.push('Compare revenue this quarter vs last quarter');
        }
        
        if (topics.includes('expenses') || topics.includes('spend')) {
            suggestions.push('Expenses by department this year');
            suggestions.push('What are our largest expense categories?');
        }
        
        if (topics.includes('utilization') || topics.includes('burden')) {
            suggestions.push('Show utilization by employee');
            suggestions.push('What is our overall burden rate?');
        }
        
        if (topics.includes('employees') || topics.includes('projects')) {
            suggestions.push('Top employees by billable hours');
            suggestions.push('Show hours by project this month');
        }
        
        // Transaction card specific suggestions
        if (templateFormat.type === 'transaction_card') {
            suggestions.push('Show me similar transactions');
            if (entityName) {
                suggestions.push(`All transactions with ${entityName}`);
            }
        }
        
        // Limit to 3 most relevant
        return suggestions.slice(0, 3);
    }
    
    /**
     * Extract markdown tables from text and convert to richContent table objects
     */
    function extractMarkdownTables(text) {
        if (!text) return { text: '', tables: [] };
        
        const tables = [];
        
        // Match markdown table pattern:
        // | header1 | header2 |
        // |:--------|--------:| (with optional alignment markers : )
        // | cell1   | cell2   |
        const tableRegex = /(?:^|\n)(\|[^\n]+\|)\s*\n(\|[\s\-:\|]+\|)\s*\n((?:\|[^\n]+\|\s*\n?)+)/g;
        
        let cleanText = text.replace(tableRegex, (match, headerRow, separatorRow, bodyRows) => {
            try {
                // Parse header - split by | and filter empty
                const headers = headerRow.split('|')
                    .map(h => h.trim())
                    .filter(h => h.length > 0);
                
                // Parse body rows
                const rows = bodyRows.trim().split('\n').map(row => {
                    const cells = row.split('|')
                        .map(cell => cell.trim())
                        .filter((cell, idx, arr) => {
                            // Keep cells, handle empty ones in middle
                            return idx > 0 && idx < arr.length - 1 || cell.length > 0;
                        });
                    
                    // Create row object with header keys
                    const rowObj = {};
                    headers.forEach((header, idx) => {
                        // Clean the header name for use as key
                        const key = header.toLowerCase()
                            .replace(/[^a-z0-9\s]/g, '')
                            .replace(/\s+/g, '_')
                            .trim() || ('col_' + idx);
                        
                        let value = cells[idx] || '';
                        
                        // Strip markdown bold/italic from values
                        value = value.replace(/\*\*/g, '').replace(/\*/g, '');
                        
                        // Strip arrows/symbols but keep the value
                        value = value.replace(/[▼▲]/g, '').trim();
                        
                        rowObj[key] = value;
                    });
                    return rowObj;
                });
                
                // Only create table if we have valid data
                if (headers.length > 0 && rows.length > 0) {
                    // Generate a title from context (look for preceding header or bold text)
                    let title = 'Data';
                    const matchStart = text.indexOf(match);
                    const precedingText = text.substring(Math.max(0, matchStart - 200), matchStart);
                    
                    // Look for markdown header
                    const headerMatch = precedingText.match(/#{1,4}\s*\*?\*?([^\n\*]+)\*?\*?\s*$/);
                    if (headerMatch) {
                        title = headerMatch[1].trim();
                    } else {
                        // Look for bold text as title
                        const boldMatch = precedingText.match(/\*\*([^\*\n]+)\*\*\s*$/);
                        if (boldMatch) {
                            title = boldMatch[1].trim();
                        }
                    }
                    
                    tables.push({
                        type: 'table',
                        title: title,
                        columns: headers.map(h => h.replace(/\*\*/g, '')), // Clean bold from headers
                        rows: rows
                    });
                }
                
                // Return empty to remove the table from text
                return '\n';
            } catch (e) {
                // If parsing fails, leave the table in the text
                log.debug('Table extraction failed', e.message);
                return match;
            }
        });
        
        // Clean up extra newlines
        cleanText = cleanText.replace(/\n{3,}/g, '\n\n').trim();
        
        return { text: cleanText, tables: tables };
    }

    /**
     * Build response from agent's final_answer
     */
    // NOTE: buildAgentResponse removed - AgentExecution has the working blocks-format version

    /**
     * Parse rich content from AI response (query results context)
     */
    function parseRichContentFromAI(text, queryResult, description, message) {
        const richContent = parseRichContentCore(text, { 
            type: 'query', 
            queryResult, 
            description, 
            message 
        });
        
        // Check if this is a single transaction result - render as card instead of table
        if (queryResult.rowCount === 1 && isSingleTransactionResult(queryResult, message || description)) {
            const row = queryResult.rows[0];
            
            // Remove any tables - transaction card replaces them
            const filteredContent = richContent.filter(r => r.type !== 'table');
            
            // Build transaction card with properly mapped data
            const cardData = buildTransactionCardData(row, queryResult.columns);
            
            filteredContent.push({
                type: 'transaction_card',
                transactionType: detectTransactionType(row, description),
                data: cardData
            });
            
            return sortRichContent(filteredContent);
        }
        
        // Always include table if nothing else was added or AI didn't suggest
        if (richContent.length === 0 || !richContent.some(r => r.type === 'table' || r.type === 'transaction_card')) {
            richContent.push({
                type: 'table',
                title: description || 'Query Results',
                columns: queryResult.columns,
                rows: queryResult.rows.slice(0, 50)
            });
        }
        
        return sortRichContent(richContent);
    }

    /**
     * Parse rich content from dashboard interpretation
     */
    function parseRichContentFromDashboard(text, dashboardData, dashboardId) {
        return parseRichContentCore(text, { type: 'dashboard', dashboardData, dashboardId });
    }
    
    /**
     * Core rich content parser - shared logic for dashboard and query results
     * Extracts rich content JSON from AI response text
     */
    function parseRichContentCore(text, context) {
        const richContent = [];
        
        // Helper to map status codes to human-readable labels (using centralized Utils.mapStatus)
        function transformRichContentItem(item) {
            if (item.type === 'transaction_card') {
                // Map status code if present
                if (item.status && typeof item.status === 'string' && item.status.length === 1) {
                    item.status = Utils.mapStatus(item.status);
                }
                // Also check inside data object if present
                if (item.data && item.data.status && typeof item.data.status === 'string' && item.data.status.length === 1) {
                    item.data.status = Utils.mapStatus(item.data.status);
                }
            }
            return item;
        }
        
        // Try to extract JSON from <rich_content> tags first
        let match = text.match(/<rich_content>([\s\S]*?)<\/rich_content>/i);
        
        // Fallback: try to find JSON array in ```json blocks
        if (!match) {
            match = text.match(/```json\s*(\[[\s\S]*?\])\s*```/i);
        }
        
        // Fallback: try to find standalone JSON array that looks like rich content
        if (!match) {
            match = text.match(/(\[\s*\{\s*"type"\s*:\s*"(?:metric|table|chart|warning|success)"[\s\S]*?\]\s*)/i);
        }
        
        if (match) {
            try {
                const jsonStr = match[1].trim();
                const suggestions = JSON.parse(jsonStr);
                
                if (Array.isArray(suggestions)) {
                    suggestions.forEach(item => {
                        // Transform item (map status codes, etc.)
                        const transformed = transformRichContentItem(item);
                        
                        // Enhanced table handling - pass through all LLM-specified properties
                        if (transformed.type === 'table' && transformed.showTable !== false) {
                            const tableConfig = {
                                type: 'table',
                                title: transformed.title || context.description || 'Results',
                                // Use LLM-provided columns/rows if available, otherwise from query
                                columns: transformed.columns || (context.queryResult ? context.queryResult.columns : []),
                                rows: transformed.rows || (context.queryResult ? context.queryResult.rows.slice(0, 100) : []),
                                
                                // Variant and grouping (LLM decides)
                                variant: transformed.variant,
                                groupBy: transformed.groupBy,
                                showSubtotals: transformed.showSubtotals,
                                subtotalColumns: transformed.subtotalColumns,
                                startCollapsed: transformed.startCollapsed,
                                hideGroupColumn: transformed.hideGroupColumn,
                                
                                // Financial statement config
                                sections: transformed.sections,
                                calculatedRows: transformed.calculatedRows,
                                
                                // Formatting and alignment
                                formatting: transformed.formatting,
                                align: transformed.align,
                                
                                // Display options
                                showGrandTotal: transformed.showGrandTotal,
                                grandTotalLabel: transformed.grandTotalLabel,
                                footer: transformed.footer
                            };
                            
                            // Clean undefined properties
                            Object.keys(tableConfig).forEach(key => {
                                if (tableConfig[key] === undefined) {
                                    delete tableConfig[key];
                                }
                            });
                            
                            richContent.push(tableConfig);
                        } else if (transformed.type === 'metric' && transformed.value !== undefined && transformed.value !== null) {
                            richContent.push({
                                type: 'metric',
                                label: transformed.label || 'Value',
                                value: transformed.value,
                                format: transformed.format || 'number',
                                delta: transformed.delta,
                                trend: transformed.trend
                            });
                        } else if (transformed.type === 'chart' && transformed.data && transformed.data.length > 0) {
                            richContent.push({
                                type: 'chart',
                                chartType: transformed.chartType || 'bar',
                                title: transformed.title,
                                data: transformed.data || (context.queryResult ? buildChartDataFromResult(context.queryResult) : transformed.data),
                                xKey: transformed.xKey,
                                yKey: transformed.yKey
                            });
                        } else if (transformed.type === 'warning' && transformed.message && transformed.message.trim()) {
                            richContent.push({
                                type: 'warning',
                                message: transformed.message
                            });
                        } else if (transformed.type === 'success' && transformed.message && transformed.message.trim()) {
                            richContent.push({
                                type: 'success', 
                                message: transformed.message
                            });
                        } else if (transformed.type === 'sparkline' && transformed.data && transformed.data.length > 0) {
                            richContent.push({
                                type: 'sparkline',
                                data: transformed.data,
                                label: transformed.label
                            });
                        } else if (transformed.type === 'transaction_card' && transformed.data) {
                            richContent.push({
                                type: 'transaction_card',
                                transactionType: transformed.transactionType,
                                data: transformed.data
                            });
                        }
                    });
                }
            } catch (parseError) {
                log.debug('Rich content parse error', { error: parseError.message, context: context.type });
            }
        }
        
        return richContent;
    }
    
    /**
     * Sort rich content: metrics first, then transaction cards, then charts/tables, then alerts
     */
    function sortRichContent(richContent) {
        const priority = {
            'metric': 1,
            'transaction_card': 2,
            'chart': 3,
            'table': 4,
            'sparkline': 5,
            'success': 6,
            'warning': 7,
            'error': 8
        };
        
        return richContent.sort((a, b) => {
            const pa = priority[a.type] || 10;
            const pb = priority[b.type] || 10;
            return pa - pb;
        });
    }
    
    /**
     * Check if query result looks like a single transaction lookup
     */
    function isSingleTransactionResult(result, message) {
        if (result.rowCount !== 1) return false;
        
        const cols = result.columns.map(c => c.toLowerCase());
        
        // Check 1: Column-based detection (flexible patterns)
        const hasTransactionCols = cols.some(c => 
            c.includes('tranid') || c.includes('tran_id') || c.includes('trandate') || c.includes('tran_date') ||
            c.includes('bill_number') || c.includes('invoice') || c.includes('order_number') || 
            c.includes('internal_id') || c.includes('id') || c.includes('number') || c.includes('document')
        );
        const hasEntity = cols.some(c => 
            c.includes('customer') || c.includes('vendor') || c.includes('entity') || c.includes('name')
        );
        const hasAmount = cols.some(c => 
            c.includes('total') || c.includes('amount') || c.includes('balance') || c.includes('due') || c.includes('gross')
        );
        
        // If columns look transaction-like, return true
        if (hasTransactionCols && (hasEntity || hasAmount)) {
            return true;
        }
        
        // Check 2: Message-based detection - if user asked for a transaction, treat single result as one
        if (message) {
            const msgLower = message.toLowerCase();
            const transactionKeywords = [
                'invoice', 'bill', 'order', 'payment', 'transaction', 'receipt',
                'credit memo', 'journal', 'estimate', 'quote', 'po', 'so',
                'find the', 'show me the', 'latest', 'most recent', 'last'
            ];
            const asksForTransaction = transactionKeywords.some(kw => msgLower.includes(kw));
            
            // If asking for a transaction and we got 1 row with any ID-like or amount-like column
            if (asksForTransaction) {
                const hasAnyId = cols.some(c => c.includes('id') || c.includes('number') || c.includes('tranid'));
                const hasAnyAmount = cols.some(c => c.includes('amount') || c.includes('total') || c.includes('balance'));
                if (hasAnyId || hasAnyAmount) {
                    return true;
                }
            }
        }
        
        return false;
    }
    
    /**
     * Build transaction card data from query row
     * Dynamically includes all available fields with pretty names
     */
    function buildTransactionCardData(row, columns) {
        const colsLower = columns.map(c => c.toLowerCase());
        
        // Helper to find value by column name patterns (returns first match)
        const findValue = (...patterns) => {
            for (const pattern of patterns) {
                const colIndex = colsLower.findIndex(c => c.includes(pattern));
                if (colIndex >= 0) {
                    const colName = columns[colIndex];
                    const val = row[colName] !== undefined ? row[colName] : row[colName.toLowerCase()];
                    if (val !== null && val !== undefined) return val;
                }
            }
            return null;
        };
        
        // Helper to find non-zero numeric value
        const findNonZeroAmount = (...patterns) => {
            for (const pattern of patterns) {
                const colIndex = colsLower.findIndex(c => c.includes(pattern));
                if (colIndex >= 0) {
                    const colName = columns[colIndex];
                    const val = row[colName] !== undefined ? row[colName] : row[colName.toLowerCase()];
                    if (val !== null && val !== undefined && val !== 0) return val;
                }
            }
            return null;
        };
        
        // Get amounts - prefer total over unpaid (unpaid could be 0 for paid bills)
        const total = findValue('foreigntotal', 'total_amount', 'total', 'gross');
        const amountUnpaid = findValue('foreignamountunpaid', 'amountunpaid', 'amount_due', 'balance', 'due', 'unpaid');
        // For display amount, use total if available, otherwise unpaid, otherwise any "amount" field
        let displayAmount = total ?? amountUnpaid ?? findValue('amount');
        
        // Get transaction type to determine if we should show positive amount for vendor bills
        const tranType = findValue('type', 'trantype', 'transaction_type');
        const isVendorTransaction = tranType && typeof tranType === 'string' && 
            (tranType.toLowerCase().includes('vend') || tranType.toLowerCase().includes('bill'));
        
        // Fix negative amounts for vendor bills (NetSuite stores them as negative)
        if (displayAmount !== null && typeof displayAmount === 'number' && displayAmount < 0 && isVendorTransaction) {
            displayAmount = Math.abs(displayAmount);
        }
        
        // Get internal ID for deep link
        const internalId = findValue('internal_id', 'internalid', 'id');
        
        // Build generic NetSuite URL - NetSuite resolves the correct record type automatically
        const url = internalId ? `/app/accounting/transactions/transaction.nl?id=${internalId}` : null;
        
        const rawStatus = findValue('status', 'statusref');
        
        // Core fields we look for specifically
        const coreData = {
            // Transaction ID/Number - critical for display
            tranid: findValue('tranid', 'tran_id', 'invoice_number', 'bill_number', 'order_number', 'document_number', 'number'),
            id: internalId,
            
            // URL for deep link to transaction in NetSuite
            url: url,
            
            // Date
            date: findValue('trandate', 'tran_date', 'invoice_date', 'bill_date', 'date'),
            
            // Due date
            duedate: findValue('duedate', 'due_date'),
            
            // Entity (customer/vendor)
            entity: findValue('customer_name', 'vendor_name', 'entity_name', 'customer', 'vendor', 'entity', 'name'),
            
            // Amounts - use display amount for main, show unpaid separately if different
            amount: displayAmount,
            amountDue: (amountUnpaid !== null && amountUnpaid !== total) ? amountUnpaid : null,
            
            // Status - mapped to human-readable label using centralized Utils.mapStatus
            status: Utils.mapStatus(rawStatus),
            
            // Type (if queried)
            type: tranType,
            
            // Memo
            memo: findValue('memo', 'description', 'notes'),
            
            // PO/Reference number
            otherrefnum: findValue('otherrefnum', 'ponum', 'po_number', 'reference'),
            
            // Terms
            terms: findValue('terms'),
            
            // Currency
            currency: findValue('currency', 'currencyname')
        };
        
        // Now add ALL other fields from the row that weren't captured above
        // This ensures we don't lose any data
        const capturedPatterns = [
            'tranid', 'tran_id', 'invoice_number', 'bill_number', 'order_number', 'document_number', 'number',
            'internal_id', 'internalid', 'id',
            'trandate', 'tran_date', 'invoice_date', 'bill_date', 'date',
            'duedate', 'due_date',
            'customer_name', 'vendor_name', 'entity_name', 'customer', 'vendor', 'entity', 'name',
            'total_amount', 'foreigntotal', 'total', 'amount', 'gross',
            'amount_due', 'foreignamountunpaid', 'amountunpaid', 'balance', 'due', 'unpaid', 'remaining',
            'status', 'statusref',
            'type', 'trantype', 'transaction_type',
            'memo', 'description', 'notes',
            'otherrefnum', 'ponum', 'po_number', 'reference',
            'terms', 'currency', 'currencyname'
        ];
        
        const additionalFields = {};
        for (const col of columns) {
            const colLower = col.toLowerCase();
            // Skip if this column was likely captured by core fields
            const alreadyCaptured = capturedPatterns.some(p => colLower.includes(p));
            if (!alreadyCaptured) {
                const value = row[col] || row[colLower];
                if (value !== null && value !== undefined && value !== '') {
                    additionalFields[col] = value;
                }
            }
        }
        
        return {
            ...coreData,
            additionalFields: Object.keys(additionalFields).length > 0 ? additionalFields : null
        };
    }
    
    /**
     * Detect transaction type from row data
     * Searches row data and description for transaction type indicators
     */
    function detectTransactionType(row, description) {
        const text = (JSON.stringify(row) + ' ' + description).toLowerCase();
        
        if (text.includes('custinvc') || text.includes('invoice')) return 'Invoice';
        if (text.includes('vendbill') || text.includes('bill')) return 'Bill';
        if (text.includes('custpymt') || text.includes('customer payment')) return 'Payment';
        if (text.includes('vendpymt') || text.includes('vendor payment')) return 'Payment';
        if (text.includes('cashsale') || text.includes('cash sale')) return 'Cash Sale';
        if (text.includes('journal') || text.includes('journalentry')) return 'Journal';
        if (text.includes('estimate') || text.includes('quote')) return 'Estimate';
        if (text.includes('salesord') || text.includes('sales order')) return 'Sales Order';
        if (text.includes('purchord') || text.includes('purchase order')) return 'Purchase Order';
        if (text.includes('creditmemo') || text.includes('credit memo')) return 'Credit Memo';
        
        return 'Transaction';
    }
    
    /**
     * Build chart data from query result
     * Returns object with data array, xKey, and yKey for charting
     */
    function buildChartDataFromResult(result) {
        if (!result || !result.rows || result.rows.length < 2) return null;
        if (!result.columns || result.columns.length < 2) return null;
        
        // Find a label column and a numeric column
        let labelCol = null;
        let valueCol = null;
        
        result.columns.forEach(col => {
            if (!labelCol && /name|category|department|customer|vendor|month|period|date|type/i.test(col)) {
                labelCol = col;
            }
            if (!valueCol && /amount|total|revenue|count|sum|balance|value/i.test(col)) {
                valueCol = col;
            }
        });
        
        if (!labelCol) labelCol = result.columns[0];
        if (!valueCol) valueCol = result.columns[result.columns.length > 1 ? 1 : 0];
        
        return {
            data: result.rows.slice(0, 10).map(row => ({
                label: row[labelCol] || 'Unknown',
                value: parseFloat(row[valueCol]) || 0
            })),
            xKey: 'label',
            yKey: 'value'
        };
    }

    return {
        // Main builders
        buildResponse: buildResponse,
        // NOTE: buildAgentResponse and buildFallbackResponse are in AgentExecution (blocks format)
        
        // Rich content parsing
        parseRichContentFromAI: parseRichContentFromAI,
        parseRichContentFromDashboard: parseRichContentFromDashboard,
        parseRichContentCore: parseRichContentCore,
        sortRichContent: sortRichContent,
        
        // Transaction cards
        isSingleTransactionResult: isSingleTransactionResult,
        buildTransactionCardData: buildTransactionCardData,
        detectTransactionType: detectTransactionType,
        
        // Utilities
        extractMarkdownTables: extractMarkdownTables,
        buildChartDataFromResult: buildChartDataFromResult,
        
        // Follow-up suggestions
        generateContextualSuggestions: generateContextualSuggestions,
        addContextualSuggestions: function(response) {
            // Add contextual suggestions if none exist and sessionContext is available
            if ((!response.followUpSuggestions || response.followUpSuggestions.length === 0) && response.sessionContext) {
                const suggestions = generateContextualSuggestions(response.sessionContext);
                if (suggestions.length > 0) {
                    response.followUpSuggestions = suggestions;
                }
            }
            return response;
        }
    };
});