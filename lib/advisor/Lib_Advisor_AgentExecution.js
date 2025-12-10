/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * 
 * Lib_Advisor_AgentExecution.js
 * Multi-step agentic execution for the Advisor module
 * 
 * Contains EXACT copies of functions from original Lib_Advisor_Orchestrator.js
 */
define([
    'N/log',
    'N/runtime',
    './Lib_Advisor_AIProviders',
    './Lib_Advisor_Prompts',
    './Lib_Advisor_Templates',
    './Lib_Advisor_QueryExecutor',
    './Lib_Advisor_QueryValidator',
    './Lib_Advisor_QueryExecution',
    './Lib_Advisor_ResponseBuilder',
    './Lib_Advisor_ToolDefinitions',
    './Lib_Advisor_EntityResolver',
    './Lib_Advisor_DashboardHandler',
    './Lib_Advisor_Planning',
    './Lib_Advisor_Utils',
    './Lib_Advisor_AdaptiveIntelligence',
    './Lib_Advisor_QueryPatterns',
    '../Lib_Model_Registry'
], function(log, runtime, AIProviders, Prompts, Templates, QueryExecutor, QueryValidator, QueryExecution, ResponseBuilder, ToolDefinitions, EntityResolver, DashboardHandler, Planning, Utils, AdaptiveIntelligence, QueryPatterns, ModelRegistry) {
    'use strict';

    // ═══════════════════════════════════════════════════════════════════════════════
    // DEBUG CONFIGURATION - Uses centralized Utils.isDebugMode()
    // Enable/disable in Settings > Main Configuration > advisorDebugMode
    // ═══════════════════════════════════════════════════════════════════════════════
    var agentDebugLog = [];
    
    // ═══════════════════════════════════════════════════════════════════════════════
    // AGENT CONFIGURATION CONSTANTS
    // ═══════════════════════════════════════════════════════════════════════════════
    var MAX_PURPOSE_FAILURES = 2;  // Skip steps that fail this many times
    var MAX_SYNTHESIS_IGNORES = 2; // Force synthesis after LLM ignores completion this many times
    
    function addAgentDebug(label, data) {
        if (Utils.isDebugMode()) {
            agentDebugLog.push({
                ts: Date.now(),
                label: label,
                data: data
            });
        }
    }
    
    function getAndClearAgentDebugLog() {
        var logCopy = agentDebugLog.slice();
        agentDebugLog = [];
        return logCopy;
    }
    
    /**
     * Finalize response with sessionContext and contextual suggestions
     * Call this before returning any response to ensure consistent formatting
     */
    function finalizeResponse(response, sessionContext) {
        if (sessionContext) {
            response.sessionContext = sessionContext;
        }
        
        // Add contextual suggestions if none exist
        ResponseBuilder.addContextualSuggestions(response);
        
        if (Utils.isDebugMode()) {
            response._agentDebugLog = getAndClearAgentDebugLog();
        }
        
        return response;
    }

    // Constants from original
    var MAX_AGENT_ITERATIONS = 8;
    var AGENT_TOOLS = ToolDefinitions.AGENT_TOOLS;
    var DEFAULT_MAX_TOKENS = Utils.DEFAULT_MAX_TOKENS;
    var GOVERNANCE_THRESHOLD_LLM = 200;
    var GOVERNANCE_THRESHOLD_QUERY = 50;

    // NOTE: checkGovernance removed - use Utils.checkGovernance
    // NOTE: buildPartialResponse removed - use Utils.buildPartialResponse
    // NOTE: executeEntityResolution removed - use EntityResolver.executeEntityResolution
    // NOTE: getAgentToolsForPlan removed - use ToolDefinitions.getAgentToolsForPlan
    // NOTE: formatResultsCompact removed - use Utils.formatResultsCompact

    // ═══════════════════════════════════════════════════════════════════════════════
    // parseQueryLimit - Extract LIMIT/FETCH FIRST from query
    // ═══════════════════════════════════════════════════════════════════════════════
    function parseQueryLimit(query) {
        if (!query) return null;
        var q = query.toUpperCase();
        
        // Match FETCH FIRST N ROWS ONLY
        var fetchMatch = q.match(/FETCH\s+FIRST\s+(\d+)\s+ROWS?\s+ONLY/);
        if (fetchMatch) {
            return parseInt(fetchMatch[1], 10);
        }
        
        // Match LIMIT N
        var limitMatch = q.match(/LIMIT\s+(\d+)/);
        if (limitMatch) {
            return parseInt(limitMatch[1], 10);
        }
        
        // Match ROWNUM <= N
        var rownumMatch = q.match(/ROWNUM\s*<=\s*(\d+)/);
        if (rownumMatch) {
            return parseInt(rownumMatch[1], 10);
        }
        
        return null;
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // executeSimplePlan - EXACT copy from original line 1936
    // ═══════════════════════════════════════════════════════════════════════════════
    function executeSimplePlan(message, plan, history, fiscalContext, steps, startTime, sessionContext, resolvedEntities) {
        var entityContext = '';
        if (resolvedEntities && Object.keys(resolvedEntities).length > 0) {
            entityContext = '\n\n══════════════════════════════════════════════════════════════\n';
            entityContext += '🚨 RESOLVED ENTITIES - YOU MUST USE THESE EXACT IDs 🚨\n';
            entityContext += '══════════════════════════════════════════════════════════════\n';
            for (var term in resolvedEntities) {
                if (resolvedEntities.hasOwnProperty(term)) {
                    var data = resolvedEntities[term];
                    entityContext += '• "' + term + '" → ' + data.name + ' (' + data.type + ', internal ID: ' + data.id + ')\n';
                }
            }
            entityContext += '\nCRITICAL INSTRUCTIONS:\n';
            entityContext += '- DO NOT use LIKE \'%name%\' patterns\n';
            entityContext += '- DO NOT search by name string\n';
            entityContext += '- USE the exact internal ID in WHERE clauses\n';
            entityContext += '\nEXAMPLE:\n';
            var firstEntity = Object.values(resolvedEntities)[0];
            if (firstEntity && firstEntity.type) {
                if (firstEntity.type === 'customer' || firstEntity.type === 'vendor') {
                    entityContext += '  WHERE transaction.entity = ' + firstEntity.id + '\n';
                } else if (firstEntity.type === 'department') {
                    entityContext += '  WHERE transactionline.department = ' + firstEntity.id + '\n';
                }
            }
            entityContext += '══════════════════════════════════════════════════════════════\n';
        }
        
        if (plan.template_match) {
            var template = Templates.getTemplate(plan.template_match);
            if (template) {
                // Build informative content for the template step
                var templateContent = template.description;
                if (template.category) {
                    templateContent = '[' + template.category + '] ' + templateContent;
                }
                
                steps.push({
                    type: 'template',
                    title: 'Using template: ' + template.name,
                    content: templateContent,
                    templateId: template.id,
                    templateCategory: template.category,
                    status: 'complete',
                    timestamp: Date.now()
                });
                
                var params = plan.extracted_params || {};
                
                if (Object.keys(params).length === 0) {
                    params = extractTemplateParams(template, message, history, plan, resolvedEntities);
                }
                
                var missingParams = (template.parameters || [])
                    .filter(function(p) { return p.required && !params[p.name]; })
                    .map(function(p) { return p.name; });
                
                if (missingParams.length > 0) {
                    log.debug('Template missing required params', { 
                        template: template.id, 
                        missing: missingParams,
                        params: params
                    });
                    
                    // Smart template switching: if income_statement_by_department is missing
                    // department_id and user didn't specify a department, switch to comparative template
                    if (template.id === 'income_statement_by_department' && 
                        missingParams.indexOf('department_id') >= 0) {
                        
                        var comparativeTemplate = Templates.getTemplate('income_statement_by_all_departments');
                        if (comparativeTemplate) {
                            log.debug('Switching to comparative department P&L template');
                            
                            steps.push({
                                type: 'template',
                                title: 'Using template: ' + comparativeTemplate.name,
                                content: 'Showing all departments (no specific department specified)',
                                templateId: comparativeTemplate.id,
                                templateCategory: comparativeTemplate.category,
                                status: 'complete',
                                timestamp: Date.now()
                            });
                            
                            var compQuery = QueryExecution.buildQueryFromTemplate(comparativeTemplate, {}, fiscalContext);
                            var compContext = Object.assign({}, sessionContext || {}, {
                                followUpSuggestions: comparativeTemplate.followUpSuggestions,
                                templateFormat: comparativeTemplate.resultFormat,
                                templateChart: comparativeTemplate.resultFormat ? comparativeTemplate.resultFormat.chartOption : null
                            });
                            return QueryExecution.executeQueryWithRetries(message, history, [], compQuery, comparativeTemplate.description, steps, startTime, 0, fiscalContext, compContext);
                        }
                    }
                    
                    // For other missing params, ask for clarification instead of silently failing
                    var clarificationText = 'I need more information to answer this question. ';
                    if (missingParams.indexOf('department_id') >= 0) {
                        clarificationText += 'Which department would you like to see? For example: "P&L for Engineering" or "Show me the Shop department income statement".';
                    } else if (missingParams.indexOf('customer_id') >= 0) {
                        clarificationText += 'Which customer are you asking about?';
                    } else if (missingParams.indexOf('vendor_id') >= 0) {
                        clarificationText += 'Which vendor are you asking about?';
                    } else {
                        clarificationText += 'Please specify: ' + missingParams.join(', ') + '.';
                    }
                    
                    // Try to fall back to AI generation, but if that fails, show clarification
                    log.debug('Template missing required params, trying AI fallback', { 
                        template: template.id, 
                        missing: missingParams
                    });
                } else {
                    var query = QueryExecution.buildQueryFromTemplate(template, params, fiscalContext);
                    var templateContext = Object.assign({}, sessionContext || {}, {
                        followUpSuggestions: template.followUpSuggestions,
                        templateFormat: template.resultFormat,
                        templateChart: template.resultFormat ? template.resultFormat.chartOption : null
                    });
                    return QueryExecution.executeQueryWithRetries(message, history, [], query, template.description, steps, startTime, 0, fiscalContext, templateContext);
                }
            }
            log.debug('Template from plan not usable', { templateId: plan.template_match });
        }
        
        // Handle multi_template execution strategy - execute multiple templates and combine results
        if (plan.execution_strategy === 'multi_template' && plan.templates && plan.templates.length > 0) {
            log.debug('Executing multi_template plan', { 
                templateCount: plan.templates.length,
                templates: plan.templates.map(function(t) { return t.template_id; }),
                requires_synthesis: plan.requires_synthesis
            });
            
            var allRichContent = [];
            var allResults = [];
            var hasAnySuccess = false;
            
            // Execute each template
            plan.templates.forEach(function(templateSpec, idx) {
                var template = Templates.getTemplate(templateSpec.template_id);
                if (!template) {
                    log.debug('Template not found in multi_template', { templateId: templateSpec.template_id });
                    return;
                }
                
                steps.push({
                    type: 'template',
                    title: 'Executing: ' + template.name,
                    content: templateSpec.purpose || template.description,
                    templateId: template.id,
                    status: 'running',
                    timestamp: Date.now()
                });
                
                var params = templateSpec.params || {};
                
                // Extract params from resolved entities if not provided
                if (Object.keys(params).length === 0) {
                    params = extractTemplateParams(template, message, history, plan, resolvedEntities);
                }
                
                // Check for missing required params
                var missingParams = (template.parameters || [])
                    .filter(function(p) { return p.required && !params[p.name]; })
                    .map(function(p) { return p.name; });
                
                if (missingParams.length > 0) {
                    log.debug('Template missing params in multi_template', { 
                        templateId: template.id, 
                        missing: missingParams 
                    });
                    steps[steps.length - 1].status = 'error';
                    steps[steps.length - 1].error = 'Missing params: ' + missingParams.join(', ');
                    return;
                }
                
                // Build and execute query
                var query = QueryExecution.buildQueryFromTemplate(template, params, fiscalContext);
                var result = QueryExecutor.executeQuery(query);
                
                if (result.success) {
                    hasAnySuccess = true;
                    steps[steps.length - 1].status = 'complete';
                    steps[steps.length - 1].sql = query;
                    steps[steps.length - 1].rowCount = result.rowCount;
                    
                    // Store raw results for synthesis
                    allResults.push({
                        templateId: template.id,
                        templateName: template.name,
                        purpose: templateSpec.purpose || template.description,
                        rows: result.rows,
                        columns: result.columns,
                        rowCount: result.rowCount
                    });
                    
                    // Interpret results to get rich content (correct parameter order!)
                    var interpreted = QueryExecution.interpretResults(
                        message,                           // message
                        template.description,              // description
                        result,                            // result (query result object)
                        history,                           // history
                        null,                              // documents
                        fiscalContext,                     // fiscalContext
                        { templateFormat: template.resultFormat }  // options
                    );
                    
                    if (interpreted.richContent && interpreted.richContent.length > 0) {
                        // Add a header for this template's results
                        allRichContent.push({
                            type: 'text',
                            content: '**' + template.name + '**'
                        });
                        allRichContent = allRichContent.concat(interpreted.richContent);
                    }
                } else {
                    steps[steps.length - 1].status = 'error';
                    steps[steps.length - 1].error = result.error;
                    log.debug('Template query failed in multi_template', { 
                        templateId: template.id, 
                        error: result.error 
                    });
                }
            });
            
            if (hasAnySuccess) {
                // If synthesis is required and we have results, call LLM to synthesize
                if (plan.requires_synthesis && allResults.length > 0) {
                    steps.push({
                        type: 'synthesis',
                        title: 'Synthesizing results',
                        status: 'running',
                        timestamp: Date.now()
                    });
                    
                    var synthesisStartTime = Date.now();
                    var synthesisResult = QueryExecution.synthesizeMultiTemplateResults(
                        message,
                        allResults,
                        plan.synthesis_instructions,
                        fiscalContext
                    );
                    
                    steps[steps.length - 1].status = 'complete';
                    steps[steps.length - 1].duration = Date.now() - synthesisStartTime;
                    
                    if (synthesisResult.success) {
                        // Prepend synthesis insights before the data tables
                        var synthesisContent = [];
                        if (synthesisResult.summary) {
                            synthesisContent.push({
                                type: 'text',
                                content: synthesisResult.summary
                            });
                        }
                        if (synthesisResult.insights && synthesisResult.insights.length > 0) {
                            synthesisContent.push({
                                type: 'callout',
                                variant: 'info',
                                content: '**Key Insights:**\n\n' + synthesisResult.insights.map(function(i) { return '• ' + i; }).join('\n')
                            });
                        }
                        
                        // Add synthesis content before the data tables
                        allRichContent = synthesisContent.concat(allRichContent);
                        
                        // Track LLM call
                        steps.push({
                            type: 'llm_calls',
                            title: '1 LLM call (' + Math.round((Date.now() - synthesisStartTime) / 1000) + 's)',
                            calls: [{
                                purpose: 'Synthesis',
                                model: synthesisResult.model || 'unknown',
                                provider: synthesisResult.provider || 'unknown',
                                duration: Date.now() - synthesisStartTime,
                                type: 'synthesis',
                                tier: 2
                            }],
                            status: 'complete',
                            timestamp: Date.now()
                        });
                    }
                }
                
                var response = ResponseBuilder.buildResponse('', steps, startTime, AIProviders.getCurrentModelInfo());
                response.richContent = allRichContent;
                response.blocksFormat = true;
                response.sessionContext = sessionContext;
                
                return finalizeResponse(response, sessionContext);
            }
            // Fall through to AI query if all templates failed
            log.debug('All templates failed in multi_template, falling back to AI');
        }
        
        if (plan.dashboard_suggestion) {
            // Build the response function with session context baked in
            const buildResponseWithContext = function(text, stepsArg, startTimeArg, options) {
                options = options || {};
                options.sessionContext = sessionContext;
                return ResponseBuilder.buildResponse(text, stepsArg, startTimeArg, options);
            };
            
            const dashboardResult = DashboardHandler.handleDashboardQuery(
                message, 
                { dashboard: plan.dashboard_suggestion }, 
                history, 
                fiscalContext, 
                steps, 
                startTime,
                buildResponseWithContext
            );
            
            // If dashboard handler returns null (fallback signal), continue to SQL path
            // Otherwise return the finalized response
            if (dashboardResult !== null) {
                return finalizeResponse(dashboardResult, sessionContext);
            }
            // Fall through to AI query generation if dashboard handler returned null
        }
        
        steps.push({
            type: 'ai',
            title: 'Generating query',
            status: 'running',
            timestamp: Date.now()
        });
        
        var ragDocuments = QueryExecution.buildRAGDocuments(fiscalContext);
        var messageWithEntities = entityContext ? message + entityContext : message;
        var aiResult = QueryExecution.generateQueryWithAI(messageWithEntities, history, ragDocuments, fiscalContext, plan.plan && plan.plan[0] ? plan.plan[0].purpose : null);
        
        steps[steps.length - 1].status = aiResult.success ? 'complete' : 'error';
        
        if (!aiResult.success || !aiResult.query) {
            steps[steps.length - 1].error = aiResult.error;
            var errorText = aiResult.error || 'Could not generate query';
            var response = ResponseBuilder.buildResponse('', steps, startTime, AIProviders.getCurrentModelInfo());
            response.richContent = [{ type: 'text', content: errorText }];
            response.blocksFormat = true;
            response.sessionContext = sessionContext;
            return response;
        }
        
        return QueryExecution.executeQueryWithRetries(message, history, ragDocuments, aiResult.query, aiResult.description, steps, startTime, 0, fiscalContext, sessionContext);
    }
    
    // NOTE: synthesizeMultiTemplateResults moved to QueryExecution.js
    
    // ═══════════════════════════════════════════════════════════════════════════════
    // extractTemplateParams - Updated to use pre-resolved entities from planning
    // ═══════════════════════════════════════════════════════════════════════════════
    function extractTemplateParams(template, message, history, plan, resolvedEntities) {
        var params = {};
        var questionLower = message.toLowerCase();
        
        if (!template.parameters) return params;
        
        var contextMessage = message;
        // Follow-up detection is now done by the LLM in the planning phase via is_follow_up field
        // Check if the plan indicates this is a follow-up (set by Planning phase)
        var isFollowUp = plan && plan.is_follow_up === true;
        
        if (isFollowUp && history && history.length > 0) {
            var lastUserMsg = null;
            for (var i = history.length - 1; i >= 0; i--) {
                if (history[i].role === 'user') {
                    lastUserMsg = history[i];
                    break;
                }
            }
            if (lastUserMsg) {
                contextMessage = lastUserMsg.content + ' ' + message;
            }
        }
        
        // Use pre-resolved entities from planning phase (no extra LLM call)
        resolvedEntities = resolvedEntities || {};
        
        // First pass: Map resolved entities to entity ID params (vendorId, customerId, etc.)
        // This enables entity-filtered templates to work automatically
        for (var term in resolvedEntities) {
            if (resolvedEntities.hasOwnProperty(term)) {
                var entity = resolvedEntities[term];
                if (entity.type === 'vendor' && entity.id) {
                    params.vendorId = entity.id;
                    params.vendor = entity.name;
                    params.vendor_id = entity.id;
                } else if (entity.type === 'customer' && entity.id) {
                    params.customerId = entity.id;
                    params.customer = entity.name;
                    params.customer_id = entity.id;
                } else if (entity.type === 'employee' && entity.id) {
                    params.employeeId = entity.id;
                    params.employee = entity.name;
                    params.employee_id = entity.id;
                } else if (entity.type === 'department' && entity.id) {
                    params.departmentId = entity.id;
                    params.department = entity.name;
                    params.department_id = entity.id;
                } else if (entity.type === 'project' && entity.id) {
                    params.projectId = entity.id;
                    params.project = entity.name;
                    params.project_id = entity.id;
                }
            }
        }
        
        template.parameters.forEach(function(param) {
            // ═══════════════════════════════════════════════════════════════
            // FIX #7: Use template's extractPattern for string params
            // ═══════════════════════════════════════════════════════════════
            if (param.type === 'string' && param.extractPattern && !params[param.name]) {
                var match = contextMessage.match(param.extractPattern);
                if (match) {
                    var value = match.slice(1).find(function(g) { return g; });
                    if (value) {
                        var cleanValue = value.trim();
                        // Check against stop words
                        var GLOBAL_STOP_WORDS = ['find', 'show', 'get', 'list', 'display', 'what', 'who', 'how',
                            'the', 'a', 'an', 'is', 'are', 'latest', 'recent', 'last', 'first',
                            'from', 'for', 'with', 'their', 'them', 'this', 'that'];
                        var paramStopWords = param.stopWords || [];
                        var allStopWords = GLOBAL_STOP_WORDS.concat(paramStopWords);
                        
                        if (allStopWords.indexOf(cleanValue.toLowerCase()) < 0) {
                            params[param.name] = cleanValue;
                            log.debug('Template param from extractPattern', { 
                                param: param.name, 
                                value: cleanValue 
                            });
                        }
                    }
                }
            }
            
            if (param.name === 'department' || param.name === 'customer' || param.name === 'vendor') {
                // Check resolved entities for matching type
                for (var term in resolvedEntities) {
                    if (resolvedEntities.hasOwnProperty(term)) {
                        var entity = resolvedEntities[term];
                        if (entity.type === param.name) {
                            params[param.name] = entity.name;
                            params[param.name + '_id'] = entity.id;
                            log.debug('Template param from resolved entity', { 
                                param: param.name, 
                                term: term, 
                                resolved: entity.name 
                            });
                            break;
                        }
                    }
                }
                
                // Fallback: try to resolve words from message if no match found
                if (!params[param.name] && param.name === 'department') {
                    var words = contextMessage.split(/\s+/);
                    for (var k = 0; k < words.length; k++) {
                        var word = words[k];
                        if (word.length >= 3 && /^[A-Za-z]+$/.test(word)) {
                            var deptResolution = EntityResolver.resolveEntity(word, 'department');
                            if (deptResolution.resolved) {
                                params[param.name] = deptResolution.entity.name;
                                params[param.name + '_id'] = deptResolution.entity.id;
                                break;
                            }
                        }
                    }
                }
            }
            
            // ═══════════════════════════════════════════════════════════════
            // FIX #6: Infer transaction type from resolved entity type
            // If entity is vendor and user says "invoice", use VendBill
            // ═══════════════════════════════════════════════════════════════
            if (param.name === 'type' && template.typeMapping) {
                // First check if we have a vendor entity - this changes interpretation
                var hasVendorEntity = false;
                var hasCustomerEntity = false;
                for (var entTerm in resolvedEntities) {
                    if (resolvedEntities.hasOwnProperty(entTerm)) {
                        var ent = resolvedEntities[entTerm];
                        if (ent.type === 'vendor') hasVendorEntity = true;
                        if (ent.type === 'customer') hasCustomerEntity = true;
                    }
                }
                
                // If vendor entity and user says "invoice", translate to vendor bill
                if (hasVendorEntity && !hasCustomerEntity) {
                    if (questionLower.includes('invoice')) {
                        params[param.name] = 'VendBill';
                        log.debug('Inferred transaction type from vendor entity', { 
                            type: 'VendBill', 
                            reason: 'vendor entity + invoice keyword' 
                        });
                    } else {
                        // Normal type mapping for vendor context
                        for (var keyword in template.typeMapping) {
                            if (template.typeMapping.hasOwnProperty(keyword)) {
                                if (questionLower.includes(keyword)) {
                                    params[param.name] = template.typeMapping[keyword];
                                    break;
                                }
                            }
                        }
                    }
                } else {
                    // Normal type mapping
                    for (var keyword2 in template.typeMapping) {
                        if (template.typeMapping.hasOwnProperty(keyword2)) {
                            if (questionLower.includes(keyword2)) {
                                params[param.name] = template.typeMapping[keyword2];
                                break;
                            }
                        }
                    }
                }
            }
            
            if (!params[param.name] && param.default !== undefined) {
                if (param.default === 'TODAY') {
                    params[param.name] = new Date().toISOString().split('T')[0];
                } else if (param.default === 'FIRST_DAY_OF_YEAR') {
                    var year = new Date().getFullYear();
                    params[param.name] = year + '-01-01';
                } else {
                    params[param.name] = param.default;
                }
            }
        });
        
        return params;
    }

    // NOTE: buildAgentSystemPrompt removed - use Prompts.buildAgentSystemPrompt
    // NOTE: checkToolCompliance removed - use ToolDefinitions.checkToolCompliance

    /**
     * Build richContent item from query/template result
     * Automatically detects single-transaction results and converts to transaction_card
     * Also respects explicit resultFormat.type = 'transaction_card' from template
     * Dynamically includes ALL properties from the result row
     */
    function buildRichContentItem(toolResult) {
        if (!toolResult.result || !toolResult.result.success || !toolResult.result.rows || toolResult.result.rows.length === 0) {
            return null;
        }
        
        var rows = toolResult.result.rows;
        var columns = toolResult.result.columns || [];
        var colsLower = columns.map(function(c) { return c.toLowerCase(); });
        
        // NOTE: mapStatus is now in Utils.mapStatus
        
        /**
         * Find numeric internal ID from row (for deep links)
         * Only returns id/transaction_id/internalid if it's a valid number
         */
        function findInternalId(row) {
            var idFields = ['id', 'internalid', 'transaction_id'];
            for (var i = 0; i < idFields.length; i++) {
                var field = idFields[i];
                var val = row[field];
                if (val !== undefined && val !== null) {
                    var numVal = typeof val === 'number' ? val : parseInt(val, 10);
                    if (!isNaN(numVal) && numVal > 0) {
                        return numVal;
                    }
                }
            }
            return null;
        }
        
        // Check if row has an ID-like column (flexible detection)
        var hasIdColumn = colsLower.some(function(c) { 
            return c === 'id' || c === 'internalid' || c === 'transaction_id'; 
        });
        
        // Check if row has transaction-like columns
        var hasTransactionIndicators = 
            colsLower.some(function(c) { return c === 'tranid' || c === 'document_number' || c === 'trantype' || c === 'type'; }) ||
            colsLower.some(function(c) { return c === 'amount' || c === 'foreigntotal' || c === 'total'; });
        
        // Check if template explicitly wants transaction_card format
        var explicitTransactionCard = toolResult.templateFormat && toolResult.templateFormat.type === 'transaction_card';
        
        // Detect if this should be a transaction card:
        // 1. Auto-detect: single row with transaction-like columns, OR
        // 2. Explicit: template specifies type: 'transaction_card' (use first row)
        var isTransactionCard = (rows.length === 1 && hasIdColumn && hasTransactionIndicators) || 
                                (explicitTransactionCard && rows.length > 0);
        
        if (isTransactionCard) {
            var row = rows[0];  // Use first row for transaction_card
            
            // Map transaction type to display name
            var typeMap = {
                'CustInvc': 'Invoice',
                'VendBill': 'Vendor Bill',
                'CustPymt': 'Payment',
                'VendPymt': 'Vendor Payment',
                'SalesOrd': 'Sales Order',
                'PurchOrd': 'Purchase Order',
                'CustCred': 'Credit Memo',
                'VendCred': 'Vendor Credit',
                'Journal': 'Journal',
                'Check': 'Check',
                'Estimate': 'Estimate'
            };
            var trantype = row.type || row.trantype || '';
            var displayType = typeMap[trantype] || trantype || 'Transaction';
            
            // Find numeric internal ID for deep links (ONLY numeric id/internalid/transaction_id)
            var internalId = findInternalId(row);
            
            // Build data object dynamically with ALL properties from the row
            var data = {};
            
            // First, set the internal ID explicitly (only if numeric)
            if (internalId) {
                data.id = internalId;
            }
            
            // Copy all row properties, transforming known fields
            Object.keys(row).forEach(function(key) {
                var val = row[key];
                var keyLower = key.toLowerCase();
                
                // Skip null/undefined values
                if (val === null || val === undefined) return;
                
                // Handle special fields with transformations
                if (keyLower === 'status') {
                    data.status = Utils.mapStatus(val);
                } else if (keyLower === 'id' || keyLower === 'internalid' || keyLower === 'transaction_id') {
                    // Already handled above as numeric id
                    // But also keep original for display if needed
                    if (keyLower !== 'id') {
                        data[key] = val;
                    }
                } else if (keyLower === 'tranid' || keyLower === 'document_number') {
                    // Normalize to tranid for display
                    data.tranid = val;
                    if (key !== 'tranid') {
                        data[key] = val; // Keep original too
                    }
                } else if (keyLower === 'trandate' || keyLower === 'date') {
                    data.date = val;
                    if (key !== 'date') {
                        data[key] = val;
                    }
                } else if (keyLower === 'entity' || keyLower === 'vendor_name' || keyLower === 'customer_name') {
                    data.entity = val;
                    if (key !== 'entity') {
                        data[key] = val;
                    }
                } else if (keyLower === 'amount' || keyLower === 'foreigntotal') {
                    data.amount = val;
                    if (key !== 'amount') {
                        data[key] = val;
                    }
                } else {
                    // All other fields - copy as-is
                    data[key] = val;
                }
            });
            
            return {
                type: 'transaction_card',
                transactionType: displayType,
                data: data
            };
        } else {
            // Build table with template format if available
            var tableItem = {
                type: 'table',
                title: toolResult.purpose || toolResult.template_id || 'Results',
                columns: columns,
                rows: rows.slice(0, 200) // Increase limit for financial statements
            };
            
            // Apply template's resultFormat if available
            if (toolResult.templateFormat) {
                var fmt = toolResult.templateFormat;
                
                // Apply pivot transformation FIRST if enabled
                if (fmt.pivotConfig && fmt.pivotConfig.enabled) {
                    var pivotResult = Utils.applyPivotTransformation(rows, columns, fmt.pivotConfig);
                    if (pivotResult.pivotApplied) {
                        tableItem.rows = pivotResult.rows.slice(0, 500); // Higher limit for pivoted
                        tableItem.columns = pivotResult.columns;
                        // Use rowGroupField for grouping in pivoted view
                        if (pivotResult.groupBy) {
                            tableItem.groupBy = pivotResult.groupBy;
                        }
                        tableItem.showSubtotals = true;
                    }
                }
                
                // Copy variant (e.g., 'grouped', 'financial_statement')
                if (fmt.variant) {
                    tableItem.variant = fmt.variant;
                }
                
                // Copy groupBy for grouped tables (only if not already set by pivot)
                if (fmt.groupBy && !tableItem.groupBy) {
                    tableItem.groupBy = fmt.groupBy;
                }
                
                // Copy calculatedTotals for financial statements
                if (fmt.calculatedTotals) {
                    tableItem.calculatedTotals = fmt.calculatedTotals;
                }
                
                // Copy column formatting (currency, percent, etc.)
                if (fmt.formatting) {
                    tableItem.formatting = fmt.formatting;
                }
                
                // Copy sections if defined
                if (fmt.sections) {
                    tableItem.sections = fmt.sections;
                }
                
                // Copy pivotConfig if defined (for frontend reference)
                if (fmt.pivotConfig) {
                    tableItem.pivotConfig = fmt.pivotConfig;
                }
            }
            
            return tableItem;
        }
    }

    /**
     * Check if we can auto-return without LLM synthesis
     * Returns response object if ready, null if agent should continue
     */
    function tryAutoReturn(plan, toolResults, resolvedEntities, fiscalContext, steps, startTime, aiResult, titleOverride) {
        // Must have synthesis disabled
        if (plan.requires_synthesis !== false) {
            return null;
        }
        
        // Count completed vs planned data steps
        var completedDataSteps = toolResults.filter(function(tr) {
            return (tr.tool === 'query' || tr.tool === 'execute_template') && tr.result && tr.result.success;
        }).length;
        
        var totalDataSteps = plan.plan ? plan.plan.filter(function(s) {
            return s.action === 'query' || s.action === 'template';
        }).length : (plan.template_match ? 1 : 0);
        
        // Not ready if we haven't completed all steps
        if (completedDataSteps < totalDataSteps || totalDataSteps === 0) {
            return null;
        }
        
        addAgentDebug('Auto-return (no synthesis needed)', {
            completedDataSteps: completedDataSteps,
            totalDataSteps: totalDataSteps,
            requires_synthesis: plan.requires_synthesis
        });
        
        // Build descriptive title
        var autoText = titleOverride || 'Results';
        
        // Add context from resolved entities
        var entityContext = [];
        if (resolvedEntities) {
            for (var key in resolvedEntities) {
                if (resolvedEntities.hasOwnProperty(key) && resolvedEntities[key].name) {
                    entityContext.push(resolvedEntities[key].name);
                }
            }
        }
        if (entityContext.length > 0 && autoText.indexOf(entityContext[0]) === -1) {
            autoText += ' for ' + entityContext.join(', ');
        }
        
        // Add fiscal year context
        if (fiscalContext && fiscalContext.fiscalYearName) {
            autoText += ' (' + fiscalContext.fiscalYearName + ')';
        }
        
        autoText += ':';
        
        steps.push({
            type: 'agent_step',
            title: 'Results ready',
            status: 'complete',
            timestamp: Date.now()
        });
        
        // Build blocks-format response
        var richContentBlocks = [];
        
        // Add text as first block
        if (autoText && autoText.trim()) {
            richContentBlocks.push({ type: 'text', content: autoText });
        }
        
        // Build richContent from all successful data steps
        toolResults.forEach(function(tr) {
            if (tr.tool === 'query' || tr.tool === 'execute_template') {
                var item = buildRichContentItem(tr);
                if (item) {
                    richContentBlocks.push(item);
                }
            }
        });
        
        var autoResponse = ResponseBuilder.buildResponse('', steps, startTime, {
            model: aiResult.model,
            provider: aiResult.provider
        });
        
        autoResponse.richContent = richContentBlocks;
        autoResponse.blocksFormat = true;
        autoResponse.autoSynthesized = true;
        
        if (Utils.isDebugMode()) {
            autoResponse._agentDebugLog = getAndClearAgentDebugLog();
        }
        
        return autoResponse;
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // executeAgentQuery - EXACT copy from original line 3241
    // ═══════════════════════════════════════════════════════════════════════════════
    function executeAgentQuery(args, fiscalContext) {
        var cleanedQuery = Utils.cleanQuery(args.query);
        var validation = QueryValidator.validateQuery(cleanedQuery);
        if (!validation.valid) {
            var guidance = ModelRegistry.getGuidanceForError('SYNTAX');
            return { 
                success: false, 
                error: validation.reason,
                errorType: 'SYNTAX',
                retryGuidance: guidance.guidance,
                example: guidance.example
            };
        }
        
        // Auto-fix missing transaction filters
        if (validation.warnings && validation.warnings.length > 0) {
            cleanedQuery = autoFixTransactionFilters(cleanedQuery, validation.warnings);
        }
        
        var result = QueryExecutor.executeQuery(cleanedQuery);
        
        if (!result.success) {
            var errorType = classifyQueryError(result.error);
            var errorGuidance = ModelRegistry.getGuidanceForError(errorType);
            result.errorType = errorType;
            result.retryGuidance = errorGuidance.guidance;
            result.example = errorGuidance.example;
            
            // Get SQL-specific guidance from QueryPatterns (domain knowledge lives there)
            var querySpecificGuidance = QueryPatterns.getQueryErrorGuidance(cleanedQuery, result.error);
            if (querySpecificGuidance) {
                result.retryGuidance = querySpecificGuidance.guidance;
                result.example = querySpecificGuidance.example;
            }
        }
        
        // Store the final query that was executed (with fixes)
        result.sql = cleanedQuery;
        
        return result;
    }
    
    /**
     * Auto-fix missing transaction filters by appending them to WHERE clause
     * 
     * IMPORTANT: Skips CTE queries (WITH ... AS) because:
     * 1. CTEs have complex scoping - tables in CTEs are not accessible in outer SELECT
     * 2. The outer SELECT often selects FROM the CTE aliases, not the original tables
     * 3. Blindly adding "AND transaction.voided = 'F'" to the outer query would fail
     *    when "transaction" table is only referenced inside CTEs
     * 
     * For CTE queries, the LLM is responsible for including proper filters inside each CTE.
     */
    function autoFixTransactionFilters(sql, warnings) {
        var fixedSql = sql;
        var filtersToAdd = [];
        
        // Skip auto-fix for CTE queries - they have complex table scoping
        // The outer SELECT may not have access to tables referenced in CTEs
        var upperSql = sql.trim().toUpperCase();
        if (upperSql.startsWith('WITH ')) {
            log.debug('Skipping auto-fix for CTE query - complex scoping', {
                warnings: warnings.map(function(w) { return w.message; })
            });
            return fixedSql;
        }
        
        warnings.forEach(function(warning) {
            if (warning.type === 'missing_filter' && warning.suggestion) {
                filtersToAdd.push(warning.suggestion);
            }
        });
        
        if (filtersToAdd.length === 0) {
            return fixedSql;
        }
        
        // Find where to insert filters (only for simple SELECT queries)
        var whereIndex = upperSql.lastIndexOf('WHERE');
        var orderByIndex = upperSql.indexOf('ORDER BY');
        var groupByIndex = upperSql.indexOf('GROUP BY');
        var fetchIndex = upperSql.indexOf('FETCH');
        var limitIndex = upperSql.indexOf('LIMIT');
        
        // Find the earliest clause after WHERE
        var insertBeforeIndex = fixedSql.length;
        if (orderByIndex > whereIndex && orderByIndex < insertBeforeIndex) insertBeforeIndex = orderByIndex;
        if (groupByIndex > whereIndex && groupByIndex < insertBeforeIndex) insertBeforeIndex = groupByIndex;
        if (fetchIndex > whereIndex && fetchIndex < insertBeforeIndex) insertBeforeIndex = fetchIndex;
        if (limitIndex > whereIndex && limitIndex < insertBeforeIndex) insertBeforeIndex = limitIndex;
        
        // Insert filters
        var filterStr = '\n    ' + filtersToAdd.join('\n    ');
        
        if (whereIndex >= 0) {
            // Has WHERE clause - add filters before ORDER BY/GROUP BY/FETCH
            fixedSql = fixedSql.substring(0, insertBeforeIndex).trimEnd() + 
                       filterStr + '\n' + 
                       fixedSql.substring(insertBeforeIndex);
        }
        
        log.debug('Auto-fixed query filters', {
            addedFilters: filtersToAdd,
            originalLength: sql.length,
            fixedLength: fixedSql.length
        });
        
        return fixedSql;
    }
    
    // ═══════════════════════════════════════════════════════════════════════════════
    // classifyQueryError - EXACT copy from original line 3273
    // ═══════════════════════════════════════════════════════════════════════════════
    function classifyQueryError(error) {
        if (!error) return 'UNKNOWN';
        var msg = error.toLowerCase();
        
        if (msg.includes('table not allowed')) return 'TABLE_NOT_ALLOWED';
        if (msg.includes('field') && msg.includes('not found')) return 'FIELD_NOT_FOUND';
        if (msg.includes('invalid search') || msg.includes('invalid column') || msg.includes('unknown column')) return 'INVALID_FIELD';
        if (msg.includes('invalid table') || msg.includes('from keyword not found') || msg.includes('table or view does not exist')) return 'INVALID_TABLE';
        if (msg.includes('permission') || msg.includes('access denied') || msg.includes('not authorized')) return 'PERMISSION';
        if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('exceeded')) return 'TIMEOUT';
        if (msg.includes('syntax') || msg.includes('unexpected token') || msg.includes('parse error') || msg.includes('failed to parse')) return 'SYNTAX';
        
        return 'UNKNOWN';
    }

    // NOTE: executeAgentDashboard removed - use DashboardHandler.executeAgentDashboard

    // ═══════════════════════════════════════════════════════════════════════════════
    // attemptDirectQueryExecution - Fallback when LLM refuses to call tools
    // ═══════════════════════════════════════════════════════════════════════════════
    function attemptDirectQueryExecution(planStep, fiscalContext, message, previousToolResults) {
        try {
            var purpose = planStep.purpose.toLowerCase();
            var sql = null;
            
            // Pattern matching for common query types
            if (purpose.indexOf('revenue') > -1 && purpose.indexOf('department') > -1) {
                // Revenue by department query
                var isLastYear = purpose.indexOf('last year') > -1 || purpose.indexOf('previous') > -1;
                var yearStart = isLastYear ? 
                    fiscalContext.fiscalYearStart.replace(/^\d{4}/, function(y) { return parseInt(y) - 1; }) :
                    fiscalContext.fiscalYearStart;
                var yearEnd = isLastYear ?
                    fiscalContext.currentDate.replace(/^\d{4}/, function(y) { return parseInt(y) - 1; }) :
                    fiscalContext.currentDate;
                
                sql = "SELECT BUILTIN.DF(transactionline.department) AS department_name, " +
                      "SUM(-1 * transactionaccountingline.amount) AS revenue " +
                      "FROM transactionaccountingline " +
                      "INNER JOIN transaction ON transactionaccountingline.transaction = transaction.id " +
                      "INNER JOIN account ON transactionaccountingline.account = account.id " +
                      "INNER JOIN transactionline ON transactionline.transaction = transaction.id " +
                      "AND transactionline.id = transactionaccountingline.transactionline " +
                      "AND transactionline.mainline = 'F' " +
                      "WHERE transaction.posting = 'T' " +
                      "AND account.accttype IN ('Income', 'OthIncome') " +
                      "AND transaction.trandate >= TO_DATE('" + yearStart + "', 'YYYY-MM-DD') " +
                      "AND transaction.trandate < TO_DATE('" + yearEnd + "', 'YYYY-MM-DD') " +
                      "GROUP BY BUILTIN.DF(transactionline.department) " +
                      "ORDER BY revenue DESC";
            } else if (purpose.indexOf('expense') > -1 && purpose.indexOf('department') > -1) {
                // Expense by department query
                var isLastYearExp = purpose.indexOf('last year') > -1 || purpose.indexOf('previous') > -1;
                var yearStartExp = isLastYearExp ? 
                    fiscalContext.fiscalYearStart.replace(/^\d{4}/, function(y) { return parseInt(y) - 1; }) :
                    fiscalContext.fiscalYearStart;
                var yearEndExp = isLastYearExp ?
                    fiscalContext.currentDate.replace(/^\d{4}/, function(y) { return parseInt(y) - 1; }) :
                    fiscalContext.currentDate;
                
                sql = "SELECT BUILTIN.DF(transactionline.department) AS department_name, " +
                      "SUM(transactionaccountingline.amount) AS expenses " +
                      "FROM transactionaccountingline " +
                      "INNER JOIN transaction ON transactionaccountingline.transaction = transaction.id " +
                      "INNER JOIN account ON transactionaccountingline.account = account.id " +
                      "INNER JOIN transactionline ON transactionline.transaction = transaction.id " +
                      "AND transactionline.id = transactionaccountingline.transactionline " +
                      "AND transactionline.mainline = 'F' " +
                      "WHERE transaction.posting = 'T' " +
                      "AND account.accttype IN ('Expense', 'OthExpense') " +
                      "AND transaction.trandate >= TO_DATE('" + yearStartExp + "', 'YYYY-MM-DD') " +
                      "AND transaction.trandate < TO_DATE('" + yearEndExp + "', 'YYYY-MM-DD') " +
                      "GROUP BY BUILTIN.DF(transactionline.department) " +
                      "ORDER BY expenses DESC";
            } else if (purpose.indexOf('vendor') > -1 && (purpose.indexOf('spend') > -1 || purpose.indexOf('bill') > -1)) {
                // Vendor spend query - handles "vendor spend for prior fiscal year" patterns
                var isPriorYear = purpose.indexOf('prior') > -1 || purpose.indexOf('previous') > -1 || purpose.indexOf('last year') > -1;
                var vendorYearStart = isPriorYear ? 
                    fiscalContext.fiscalYearStart.replace(/^\d{4}/, function(y) { return parseInt(y) - 1; }) :
                    fiscalContext.fiscalYearStart;
                var vendorYearEnd = isPriorYear ?
                    fiscalContext.fiscalYearEnd.replace(/^\d{4}/, function(y) { return parseInt(y) - 1; }) :
                    fiscalContext.fiscalYearEnd;
                
                sql = "SELECT BUILTIN.DF(transaction.entity) AS vendor_name, " +
                      "transaction.entity AS vendor_id, " +
                      "SUM(transactionaccountingline.amount) AS total_spend " +
                      "FROM transactionaccountingline " +
                      "INNER JOIN transaction ON transactionaccountingline.transaction = transaction.id " +
                      "INNER JOIN account ON transactionaccountingline.account = account.id " +
                      "INNER JOIN transactionline ON transactionline.transaction = transaction.id " +
                      "AND transactionline.id = transactionaccountingline.transactionline " +
                      "WHERE transaction.posting = 'T' " +
                      "AND transactionline.mainline = 'F' " +
                      "AND transaction.type IN ('VendBill', 'VendCred') " +
                      "AND account.accttype IN ('Expense', 'OthExpense', 'COGS') " +
                      "AND transaction.trandate >= TO_DATE('" + vendorYearStart + "', 'YYYY-MM-DD') " +
                      "AND transaction.trandate < TO_DATE('" + vendorYearEnd + "', 'YYYY-MM-DD') " +
                      "GROUP BY BUILTIN.DF(transaction.entity), transaction.entity " +
                      "ORDER BY total_spend DESC";
            }
            
            if (!sql) {
                log.debug('attemptDirectQueryExecution: No pattern match for purpose', { purpose: purpose });
                return null;
            }
            
            log.audit('attemptDirectQueryExecution: Executing fallback query', { purpose: purpose });
            
            var queryResult = QueryExecution.executeQuery(sql, {
                purpose: planStep.purpose,
                maxRows: 100
            });
            
            if (queryResult.success) {
                queryResult.sql = sql;
                return queryResult;
            }
            
            return null;
        } catch (e) {
            log.error('attemptDirectQueryExecution failed', { error: e.message });
            return null;
        }
    }
    
    /**
     * Scan LLM text response for template IDs and execute if found
     * This handles cases where LLM returns text mentioning a template instead of calling the tool
     */
    function scanTextForTemplateAndExecute(text, fiscalContext, resolvedEntities) {
        if (!text || typeof text !== 'string') return null;
        
        var allTemplates = Templates.getAllTemplates ? Templates.getAllTemplates() : (Templates.TEMPLATES || []);
        if (!allTemplates || allTemplates.length === 0) return null;
        
        var textLower = text.toLowerCase();
        var matchedTemplate = null;
        
        // Scan for exact template ID matches
        for (var i = 0; i < allTemplates.length; i++) {
            var template = allTemplates[i];
            if (template.id && textLower.indexOf(template.id.toLowerCase()) > -1) {
                matchedTemplate = template;
                log.audit('scanTextForTemplateAndExecute: Found template ID in text', { 
                    templateId: template.id,
                    textSnippet: text.substring(0, 200)
                });
                break;
            }
        }
        
        if (!matchedTemplate) {
            return null;
        }
        
        // Build params from resolved entities
        var params = {};
        if (resolvedEntities) {
            Object.keys(resolvedEntities).forEach(function(key) {
                var entity = resolvedEntities[key];
                if (entity && entity.id) {
                    if (entity.type === 'vendor') params.vendor_id = entity.id;
                    if (entity.type === 'customer') params.customer_id = entity.id;
                    if (entity.type === 'employee') params.employee_id = entity.id;
                    if (entity.type === 'item') params.item_id = entity.id;
                }
            });
        }
        
        log.audit('scanTextForTemplateAndExecute: Executing template', { 
            templateId: matchedTemplate.id,
            params: JSON.stringify(params)
        });
        
        var templateResult = QueryExecution.executeTemplate(matchedTemplate.id, params, fiscalContext);
        
        if (templateResult && templateResult.success) {
            templateResult.template_id = matchedTemplate.id;
            templateResult._autoDetected = true;
            return templateResult;
        }
        
        return null;
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // buildAgentPrompt - EXACT copy from original line 3089 (see continuation)
    // ═══════════════════════════════════════════════════════════════════════════════
    function buildAgentPrompt(message, plan, toolResults, iteration, workingMemory, skippedPurposes) {
        skippedPurposes = skippedPurposes || [];
        var prompt = 'QUESTION: ' + message + '\n\n';
        
        // Include working memory if provided and has meaningful content
        if (workingMemory && (workingMemory.hypotheses.length > 0 || 
                              workingMemory.findings.length > 0 || 
                              workingMemory.anomalies.length > 0 ||
                              iteration >= 2)) {
            prompt += AdaptiveIntelligence.serializeWorkingMemory(workingMemory) + '\n\n';
        }
        
        var dataGatheringResults = toolResults.filter(function(r) {
            return (r.tool === 'query' || r.tool === 'execute_template') && r.result && r.result.success;
        });
        
        prompt += 'PROGRESS:\n';
        var planSteps = plan.plan || [];
        planSteps.forEach(function(step, i) {
            var done = dataGatheringResults.length > i;
            prompt += (done ? '✓' : '○') + ' ' + step.purpose + '\n';
        });
        
        if (toolResults.length > 0) {
            prompt += '\nDATA GATHERED:\n';
            var hasErrors = false;
            
            toolResults.forEach(function(tr, index) {
                prompt += '\n━━━ Step ' + tr.step + ': ' + (tr.purpose || tr.dashboard || tr.operation || tr.term || tr.template_id) + ' ━━━\n';
                
                // ALWAYS show full data for ALL steps - no truncation for older steps
                
                if (tr.tool === 'query') {
                    if (tr.result.success) {
                        var limitInfo = '';
                        var queryLimit = tr.queryLimit;
                        var rowCount = tr.result.rowCount;
                        
                        // Build limit info message
                        if (queryLimit) {
                            if (rowCount < queryLimit) {
                                limitInfo = ' (query had LIMIT ' + queryLimit + ', returned all ' + rowCount + ' matching rows - NO MORE DATA EXISTS)';
                            } else if (rowCount === queryLimit) {
                                limitInfo = ' (query had LIMIT ' + queryLimit + ', returned exactly ' + queryLimit + ' - this is ALL the data you requested)';
                            }
                        }
                        
                        prompt += rowCount + ' rows' + limitInfo + '. Columns: ' + (tr.result.columns || []).join(', ') + '\n';
                        var maxAgentRows = 500;
                        prompt += Utils.formatResultsCompact(tr.result, maxAgentRows) + '\n';
                        if (rowCount > maxAgentRows) {
                            prompt += '⚠️ TRUNCATED: Showing ' + maxAgentRows + ' of ' + rowCount + ' rows. Consider filtering or aggregating.\n';
                        }
                        
                        // Add explicit guidance about more_rows
                        if (queryLimit && rowCount <= queryLimit) {
                            prompt += '⚠️ DO NOT call inspect_result(more_rows) - you already have all the data.\n';
                        }
                    } else {
                        hasErrors = true;
                        prompt += 'ERROR: ' + tr.result.error + '\n';
                        if (tr.result.retryGuidance) {
                            prompt += 'RETRY GUIDANCE: ' + tr.result.retryGuidance + '\n';
                            if (tr.result.example) {
                                prompt += 'EXAMPLE FIX: ' + tr.result.example + '\n';
                            }
                        }
                        // Include reflection hint if one was added
                        if (tr.result.reflectionHint) {
                            prompt += '\n' + tr.result.reflectionHint + '\n';
                        }
                    }
                } else if (tr.tool === 'execute_template') {
                    var fiscalInfo = tr.result && tr.result.substitutions && tr.result.substitutions.fiscal_year ? ' [' + tr.result.substitutions.fiscal_year + ']' : '';
                    if (tr.result && tr.result.success) {
                        prompt += 'Template: ' + tr.template_id + fiscalInfo + '\n';
                        prompt += tr.result.rowCount + ' rows. Columns: ' + (tr.result.columns || []).join(', ') + '\n';
                        var maxAgentRows = 500;
                        prompt += Utils.formatResultsCompact(tr.result, maxAgentRows) + '\n';
                        if (tr.result.rowCount > maxAgentRows) {
                            prompt += '⚠️ TRUNCATED: Showing ' + maxAgentRows + ' of ' + tr.result.rowCount + ' rows. Consider filtering or aggregating.\n';
                        }
                        
                        if (tr.result.substitutions && tr.result.substitutions.fiscal_year === 'current' && tr.purpose && tr.purpose.toLowerCase().includes('last')) {
                            prompt += '⚠️ WARNING: You queried "last year" but got CURRENT year data. You must pass fiscal_year: "previous" parameter!\n';
                        }
                    } else {
                        hasErrors = true;
                        prompt += 'Template ERROR: ' + (tr.result ? tr.result.error : 'Unknown error') + '\n';
                        if (tr.result && tr.result.zeroRowGuidance) {
                            prompt += 'GUIDANCE: ' + tr.result.zeroRowGuidance + '\n';
                        }
                    }
                } else if ((tr.tool === 'dashboard' || tr.tool === 'get_dashboard_data') && tr.result && tr.result.success) {
                    // Include full dashboard data, not just summary
                    prompt += 'Dashboard: ' + tr.dashboard + '\n';
                    prompt += DashboardHandler.summarizeDashboardForAgent(tr.dashboard, tr.result.data) + '\n';
                    // Also include the raw data structure for the LLM to analyze
                    try {
                        var dashJson = JSON.stringify(tr.result.data, null, 0);
                        if (dashJson.length > 2000) {
                            dashJson = dashJson.substring(0, 2000) + '...(truncated)';
                        }
                        prompt += 'Full data: ' + dashJson + '\n';
                    } catch (e) {
                        prompt += 'Data available but could not serialize\n';
                    }
                } else if (tr.tool === 'resolve_entity') {
                    if (tr.result.duplicate) {
                        prompt += '⚠️ ALREADY RESOLVED: You already resolved "' + tr.term + '" - use the result from before!\n';
                        if (tr.result.previousResult && tr.result.previousResult.resolved) {
                            prompt += 'USE: ID=' + tr.result.previousResult.id + ', Name="' + tr.result.previousResult.name + '"\n';
                        }
                        prompt += 'NOW EXECUTE YOUR QUERY using this entity ID.\n';
                    } else if (tr.result.resolved) {
                        prompt += '✓ RESOLVED: "' + tr.term + '" → "' + tr.result.name + '" (ID: ' + tr.result.id + ')\n';
                        prompt += 'NOW USE THIS IN YOUR QUERY: WHERE entity = ' + tr.result.id + '\n';
                    } else if (tr.result.ambiguous) {
                        prompt += '⚠️ AMBIGUOUS: Multiple matches for "' + tr.term + '":\n';
                        tr.result.options.slice(0, 5).forEach(function(opt) {
                            prompt += '  - ' + opt.name + ' (ID: ' + opt.id + ')\n';
                        });
                        prompt += 'Pick the most likely one and use its ID in your query.\n';
                    } else if (tr.result.notFound) {
                        prompt += '✗ NOT FOUND: No ' + tr.entityType + ' matching "' + tr.term + '"\n';
                        if (tr.result.suggestions && tr.result.suggestions.length > 0) {
                            prompt += 'Did you mean: ' + tr.result.suggestions.map(function(s) { return s.name; }).join(', ') + '?\n';
                        }
                    }
                } else if (tr.tool === 'think') {
                    prompt += '📊 ANALYSIS:\n';
                    prompt += 'Observations: ' + tr.observations + '\n';
                    if (tr.data_gaps && tr.data_gaps.length > 0) {
                        prompt += 'Data gaps: ' + tr.data_gaps.join(', ') + '\n';
                    }
                    prompt += 'Next: ' + tr.next_action + ' - ' + tr.reasoning + '\n';
                } else if (tr.tool === 'deep_think') {
                    prompt += '🧠 DEEP THINKING (' + tr.thinking_type + '):\n';
                    if (tr.reasoning_steps && tr.reasoning_steps.length > 0) {
                        prompt += 'Reasoning:\n';
                        tr.reasoning_steps.forEach(function(step, i) {
                            prompt += '  ' + (i + 1) + '. ' + step + '\n';
                        });
                    }
                    if (tr.updates && tr.updates.length > 0) {
                        prompt += 'Working memory updates: ' + tr.updates.join('; ') + '\n';
                    }
                    if (tr.planChanges) {
                        prompt += '📋 Plan modified: ' + (tr.planChanges.reason || 'adjusted') + '\n';
                    }
                    prompt += 'Next action: ' + tr.nextAction + '\n';
                } else if (tr.tool === 'reflect') {
                    prompt += '🔄 REFLECTION:\n';
                    prompt += 'Analysis: ' + (tr.analysis ? tr.analysis.substring(0, 200) : 'analyzed') + '\n';
                    prompt += 'Assessment: ' + tr.plan_assessment + ' (confidence: ' + tr.confidence + ')\n';
                    if (tr.key_findings && tr.key_findings.length > 0) {
                        prompt += 'Key findings: ' + tr.key_findings.slice(0, 3).join('; ') + '\n';
                    }
                    if (tr.plan_modifications && tr.plan_modifications.length > 0) {
                        prompt += 'Plan modified: ' + tr.plan_modifications.length + ' change(s)\n';
                    }
                } else if (tr.tool === 'inspect_result') {
                    if (tr.result && tr.result.success) {
                        prompt += '🔍 INSPECTION of step ' + tr.sourceStep + ' (' + tr.action + '):\n';
                        prompt += tr.result.rowCount + ' rows. ' + (tr.result.filterApplied || tr.result.aggregation || '') + '\n';
                        var maxAgentRows = 500;
                        prompt += Utils.formatResultsCompact(tr.result, maxAgentRows) + '\n';
                        if (tr.result.rowCount > maxAgentRows) {
                            prompt += '⚠️ TRUNCATED: Showing ' + maxAgentRows + ' of ' + tr.result.rowCount + ' rows.\n';
                        }
                    } else {
                        prompt += '⚠️ Inspection failed: ' + (tr.error || (tr.result ? tr.result.error : 'Unknown error')) + '\n';
                    }
                } else if (tr.tool === 'system_hint') {
                    prompt += '💡 ' + tr.message + '\n';
                } else if (tr.tool === '_incomplete_plan_warning') {
                    prompt += tr.warning + '\n';
                }
            });
            
            if (hasErrors) {
                prompt += '\n⚠️ IMPORTANT: Some queries failed. Use the guidance above to fix the query and retry. Common fixes:\n- Use correct field names from SuiteQL schema\n- Add proper table aliases\n- Check date formats (ALWAYS use TO_DATE for date comparisons)\n- Simplify complex joins\n';
            }
        }
        
        // Add guidance about skipped steps due to repeated failures
        if (skippedPurposes && skippedPurposes.length > 0) {
            prompt += '\n⚠️ SKIPPED STEPS (failed ' + MAX_PURPOSE_FAILURES + '+ times - proceeding without this data):\n';
            skippedPurposes.forEach(function(p) {
                prompt += '  • ' + p + '\n';
            });
            prompt += 'Continue with the data you have. Note these limitations in your response.\n';
        }
        
        // Count only data-gathering steps (not resolve_entity which is done upfront, not synthesize which is final_answer)
        var dataGatheringActions = ['query', 'template'];
        var planStepsCompleted = plan.plan ? 
            toolResults.filter(function(tr) {
                return (tr.tool === 'query' || tr.tool === 'execute_template') && tr.result && tr.result.success;
            }).length : 0;
        var totalPlanSteps = plan.plan ? plan.plan.filter(function(s) { 
            return dataGatheringActions.indexOf(s.action) >= 0;
        }).length : 0;
        
        // Adjust for skipped steps - count them as "done" (with failure) so LLM can proceed
        var skippedStepCount = skippedPurposes ? skippedPurposes.length : 0;
        var effectiveCompletedSteps = planStepsCompleted + skippedStepCount;
        
        // If no explicit data steps in plan but we have a template_match, count that as 1 step
        if (totalPlanSteps === 0 && plan.template_match) {
            totalPlanSteps = 1;
        }
        
        var allStepsComplete = effectiveCompletedSteps >= totalPlanSteps && totalPlanSteps > 0;
        
        addAgentDebug('Step completion check', {
            planStepsCompleted: planStepsCompleted,
            skippedStepCount: skippedStepCount,
            effectiveCompletedSteps: effectiveCompletedSteps,
            totalPlanSteps: totalPlanSteps,
            allStepsComplete: allStepsComplete,
            templateMatch: plan.template_match
        });
        
        if (allStepsComplete) {
            var partialDataNote = skippedStepCount > 0 ? ' Note: Some steps failed and were skipped - mention data limitations in your response.' : '';
            
            // Count successful data queries
            var successfulQueries = toolResults.filter(function(tr) {
                return (tr.tool === 'query' || tr.tool === 'execute_template') && tr.result && tr.result.success;
            });
            
            // Build required blocks guidance
            var dataBlocksGuidance = '';
            if (successfulQueries.length > 0) {
                dataBlocksGuidance = '\n\n⚠️ CRITICAL: Your final_response MUST include:\n';
                dataBlocksGuidance += '1. At least ONE table block using resultRef to show the collected data\n';
                dataBlocksGuidance += '2. At least ONE metrics block with calculated totals from the data\n';
                dataBlocksGuidance += '3. Text blocks explaining the data - do NOT just say "data has been prepared"\n\n';
                dataBlocksGuidance += 'Available data to reference:\n';
                successfulQueries.forEach(function(q, idx) {
                    dataBlocksGuidance += '• resultRef: ' + q.step + ' - ' + (q.purpose || 'Query ' + (idx + 1)) + ' (' + q.result.rowCount + ' rows)\n';
                });
                dataBlocksGuidance += '\nA response with ONLY text saying "data is ready" is NOT acceptable. You MUST include the actual data.';
            }
            
            prompt += '\n\n🎯 ALL PLAN STEPS COMPLETE. You have gathered all the data needed.' + partialDataNote + dataBlocksGuidance + ' NOW YOU MUST call the final_response tool with structured blocks to provide the answer to the user. Do NOT execute more queries - call final_response NOW.';
        } else if (iteration === 0) {
            prompt += '\nExecute the first step.';
        } else {
            // ═══════════════════════════════════════════════════════════════
            // PROGRESS GATE: Force query execution if stuck in schema discovery
            // ═══════════════════════════════════════════════════════════════
            var schemaOnlyIterations = toolResults.filter(function(tr) {
                return tr.tool === 'get_record_schema';
            }).length;
            var queryExecutionCount = toolResults.filter(function(tr) {
                return tr.tool === 'query' || tr.tool === 'execute_template';
            }).length;
            
            // If we've done 3+ schema requests without any queries, force query execution
            if (schemaOnlyIterations >= 3 && queryExecutionCount === 0) {
                prompt += '\n\n🚨 CRITICAL: You have spent ' + schemaOnlyIterations + ' iterations on schema discovery WITHOUT executing any queries. ';
                prompt += 'You MUST now execute a query using the information you have.\n\n';
                prompt += 'KNOWN WORKING QUERY PATTERNS:\n\n';
                prompt += '1. Expenses by Account:\n';
                prompt += 'SELECT account.accountsearchdisplayname AS expense_account, SUM(transactionaccountingline.amount) AS amount\n';
                prompt += 'FROM transactionaccountingline\n';
                prompt += 'INNER JOIN transaction ON transactionaccountingline.transaction = transaction.id\n';
                prompt += 'INNER JOIN account ON transactionaccountingline.account = account.id\n';
                prompt += 'WHERE account.accttype = \'Expense\' AND transaction.posting = \'T\' AND transaction.voided = \'F\'\n';
                prompt += 'GROUP BY account.accountsearchdisplayname\n';
                prompt += 'ORDER BY amount DESC\n\n';
                prompt += '2. Revenue by Customer:\n';
                prompt += 'SELECT BUILTIN.DF(transaction.entity) AS customer, SUM(transaction.foreigntotal) AS revenue\n';
                prompt += 'FROM transaction\n';
                prompt += 'WHERE transaction.type IN (\'CustInvc\', \'CashSale\') AND transaction.posting = \'T\'\n';
                prompt += 'GROUP BY BUILTIN.DF(transaction.entity)\n';
                prompt += 'ORDER BY revenue DESC\n\n';
                prompt += 'STOP requesting schemas. Call execute_query NOW with one of these patterns (modified as needed).\n';
            }
            
            // More forceful prompt when steps are incomplete
            var remainingCount = totalPlanSteps - effectiveCompletedSteps;
            if (remainingCount > 0) {
                prompt += '\n\n🚨 INCOMPLETE: You have completed ' + effectiveCompletedSteps + '/' + totalPlanSteps + ' data queries. ';
                
                // Filter out skipped purposes from remaining steps
                var remainingSteps = plan.plan.filter(function(s) { 
                    if (dataGatheringActions.indexOf(s.action) < 0) return false;
                    // Skip if this purpose was already skipped
                    if (skippedPurposes && skippedPurposes.some(function(sp) {
                        return sp.toLowerCase() === (s.purpose || '').toLowerCase();
                    })) return false;
                    return true;
                }).slice(planStepsCompleted);
                
                if (remainingSteps.length > 0) {
                    prompt += 'You MUST call execute_query ' + remainingSteps.length + ' more time(s) before calling final_response. ';
                    prompt += '\n\nREMAINING QUERIES TO EXECUTE:\n';
                    remainingSteps.forEach(function(s, i) {
                        prompt += '• Step ' + (planStepsCompleted + i + 1) + ': ' + s.purpose + '\n';
                    });
                    prompt += '\nCall execute_query NOW for the next step.';
                } else {
                    // All remaining steps were skipped - proceed with available data
                    prompt += 'All remaining steps were skipped due to errors. Proceed to final_response with the data you have.';
                }
            } else {
                prompt += '\nIteration ' + (iteration + 1) + '. Continue the plan or call final_response if done.';
            }
        }
        
        // ═══════════════════════════════════════════════════════════════
        // BUG FIX: INJECT ADDED_STEPS FROM REFLECTION
        // If reflect_and_adapt added new steps, they MUST be executed
        // ═══════════════════════════════════════════════════════════════
        if (plan.added_steps && plan.added_steps.length > 0) {
            // Find added steps that haven't been executed yet
            var unexecutedAddedSteps = plan.added_steps.filter(function(addedStep) {
                // Check if a query with similar purpose has been executed
                return !toolResults.some(function(tr) {
                    return tr.tool === 'query' && 
                           tr.purpose && 
                           tr.purpose.toLowerCase() === (addedStep.purpose || '').toLowerCase();
                });
            });
            
            if (unexecutedAddedSteps.length > 0) {
                prompt += '\n\n🚨 MANDATORY: You have ' + unexecutedAddedSteps.length + ' query(s) from plan adaptation that MUST be executed:\n';
                unexecutedAddedSteps.forEach(function(addedStep, idx) {
                    prompt += '\n' + (idx + 1) + '. Purpose: ' + addedStep.purpose;
                    if (addedStep.sql) {
                        prompt += '\n   SQL: ' + addedStep.sql.substring(0, 200) + (addedStep.sql.length > 200 ? '...' : '');
                    }
                });
                prompt += '\n\nCall execute_query NOW with the first unexecuted added query. Do NOT skip these queries.';
            }
        }
        
        return prompt;
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // buildAgentResponse - Updated to handle both final_answer and final_response
    // ═══════════════════════════════════════════════════════════════════════════════
    function buildAgentResponse(finalAnswer, toolResults, steps, startTime, aiResult, message) {
        var response;
        
        // Check if this is the new blocks-based format (final_response)
        if (finalAnswer.blocks && Array.isArray(finalAnswer.blocks)) {
            response = buildBlocksResponse(finalAnswer, toolResults, steps, startTime, aiResult, message);
        } else {
            // Legacy final_answer format
            response = buildLegacyResponse(finalAnswer, toolResults, steps, startTime, aiResult, message);
        }
        
        // Add follow-up suggestions if provided
        if (finalAnswer.followUpSuggestions && finalAnswer.followUpSuggestions.length > 0) {
            response.followUpSuggestions = finalAnswer.followUpSuggestions;
        }
        
        // Attach debug log if enabled
        if (Utils.isDebugMode()) {
            response._agentDebugLog = getAndClearAgentDebugLog();
        }
        
        return response;
    }
    
    /**
     * Build response from new blocks-based final_response format
     * All blocks (including text) stay in richContent for proper ordering
     */
    function buildBlocksResponse(finalAnswer, toolResults, steps, startTime, aiResult, message) {
        var blocks = finalAnswer.blocks || [];
        var richContent = [];
        
        // Map step numbers to tool results for resultRef lookups
        var stepResultMap = {};
        var successfulQueries = [];
        toolResults.forEach(function(tr) {
            if ((tr.tool === 'query' || tr.tool === 'execute_template') && tr.result && tr.result.success) {
                stepResultMap[tr.step] = tr;
                successfulQueries.push(tr);
            }
        });
        
        // ═══════════════════════════════════════════════════════════════════════════════
        // LAZY RESPONSE DETECTION: Check if LLM provided actual data or just text
        // ═══════════════════════════════════════════════════════════════════════════════
        var hasDataBlock = blocks.some(function(b) {
            return b.type === 'table' || b.type === 'chart' || b.type === 'metrics';
        });
        var hasOnlyText = blocks.length > 0 && blocks.every(function(b) {
            return b.type === 'text' || b.type === 'callout';
        });
        var isLazyResponse = !hasDataBlock && hasOnlyText && successfulQueries.length > 0;
        
        if (isLazyResponse) {
            log.audit('Lazy response detected - auto-adding collected data', {
                blockCount: blocks.length,
                queryCount: successfulQueries.length
            });
            
            // Keep original text blocks
            blocks.forEach(function(block) {
                var processedBlock = processBlock(block, stepResultMap, toolResults);
                if (processedBlock) {
                    richContent.push(processedBlock);
                }
            });
            
            // Auto-add tables for each successful query
            successfulQueries.forEach(function(q) {
                // Add table with all rows (not sliced for financial data)
                var rowLimit = q.result.rowCount > 50 ? 200 : 50;
                var tableItem = {
                    type: 'table',
                    title: q.purpose || 'Query Results',
                    columns: q.result.columns,
                    rows: q.result.rows.slice(0, rowLimit),
                    // Preserve groupBy if this looks like financial data
                    groupBy: detectGroupByColumn(q.result.columns)
                };
                
                // Apply template's resultFormat if available (for execute_template calls)
                if (q.templateFormat) {
                    var fmt = q.templateFormat;
                    
                    // Apply pivot transformation FIRST if enabled
                    if (fmt.pivotConfig && fmt.pivotConfig.enabled) {
                        var pivotResult = Utils.applyPivotTransformation(q.result.rows, q.result.columns, fmt.pivotConfig);
                        if (pivotResult.pivotApplied) {
                            tableItem.rows = pivotResult.rows.slice(0, 500);
                            tableItem.columns = pivotResult.columns;
                            if (pivotResult.groupBy) {
                                tableItem.groupBy = pivotResult.groupBy;
                            }
                            tableItem.showSubtotals = true;
                        }
                    }
                    
                    if (fmt.variant) tableItem.variant = fmt.variant;
                    if (fmt.groupBy && !tableItem.groupBy) tableItem.groupBy = fmt.groupBy;
                    if (fmt.calculatedTotals) tableItem.calculatedTotals = fmt.calculatedTotals;
                    if (fmt.formatting) tableItem.formatting = fmt.formatting;
                    if (fmt.sections) tableItem.sections = fmt.sections;
                    if (fmt.pivotConfig) tableItem.pivotConfig = fmt.pivotConfig;
                }
                
                richContent.push(tableItem);
            });
            
            // Add a note about auto-inclusion
            richContent.push({
                type: 'callout',
                variant: 'info',
                content: 'Data tables auto-included from ' + successfulQueries.length + ' successful query(s).'
            });
            
        } else {
            // Normal processing - use LLM's blocks
            blocks.forEach(function(block) {
                var processedBlock = processBlock(block, stepResultMap, toolResults);
                if (processedBlock) {
                    richContent.push(processedBlock);
                }
            });
        }
        
        // Build response with empty text - all content is in richContent blocks
        var response = ResponseBuilder.buildResponse('', steps, startTime, {
            model: aiResult.model,
            provider: aiResult.provider
        });
        
        // Set richContent to our ordered blocks (text interspersed with data)
        response.richContent = richContent;
        response.blocksFormat = true; // Flag for frontend to render in order
        
        return response;
    }
    
    /**
     * Detect if columns suggest a groupBy column for financial statements
     */
    function detectGroupByColumn(columns) {
        if (!columns || !Array.isArray(columns)) return null;
        
        var groupByPatterns = ['type', 'account_type', 'category', 'account_type_name', 'accttype'];
        for (var i = 0; i < columns.length; i++) {
            var col = columns[i].toLowerCase().replace(/\s+/g, '_');
            if (groupByPatterns.indexOf(col) >= 0) {
                return columns[i];
            }
        }
        return null;
    }
    
    /**
     * Process a single block into richContent format
     */
    function processBlock(block, stepResultMap, toolResults) {
        if (!block || !block.type) return null;
        
        switch (block.type) {
            case 'text':
                return {
                    type: 'text',
                    content: block.content || ''
                };
                
            case 'table':
                var tableData = getBlockData(block, stepResultMap);
                if (!tableData) return null;
                return {
                    type: 'table',
                    title: block.title || 'Results',
                    columns: block.columns || tableData.columns,
                    rows: tableData.rows.slice(0, 50)
                };
                
            case 'chart':
                var chartData = getBlockData(block, stepResultMap);
                if (!chartData) return null;
                return {
                    type: 'chart',
                    chartType: block.chartType || 'bar',
                    title: block.title || 'Chart',
                    data: chartData.rows,
                    xKey: block.xKey || chartData.columns[0],
                    yKey: block.yKey || chartData.columns[1]
                };
                
            case 'metrics':
                if (!block.items || !Array.isArray(block.items)) return null;
                // Return individual metrics
                return {
                    type: 'metrics',
                    items: block.items.map(function(item) {
                        return {
                            type: 'metric',
                            label: item.label,
                            value: item.value,
                            format: item.format || 'number'
                        };
                    })
                };
                
            case 'callout':
                return {
                    type: 'callout',
                    variant: block.variant || 'info',
                    content: block.content || ''
                };
                
            default:
                // Handle nested blocks
                if (block.blocks && Array.isArray(block.blocks)) {
                    var nestedResults = block.blocks.map(function(nestedBlock) {
                        return processBlock(nestedBlock, stepResultMap, toolResults);
                    }).filter(function(b) { return b !== null; });
                    
                    if (nestedResults.length > 0) {
                        return {
                            type: 'group',
                            blocks: nestedResults
                        };
                    }
                }
                return null;
        }
    }
    
    /**
     * Get data for a block from resultRef or inline data
     */
    function getBlockData(block, stepResultMap) {
        // Direct data provided
        if (block.data && Array.isArray(block.data) && block.data.length > 0) {
            return {
                columns: Object.keys(block.data[0]),
                rows: block.data
            };
        }
        
        // Reference to a step result
        if (block.resultRef && stepResultMap[block.resultRef]) {
            var tr = stepResultMap[block.resultRef];
            return {
                columns: tr.result.columns,
                rows: tr.result.rows
            };
        }
        
        return null;
    }
    
    /**
     * Build response from legacy final_answer format (backwards compatibility)
     */
    function buildLegacyResponse(finalAnswer, toolResults, steps, startTime, aiResult, message) {
        var answerText = finalAnswer.answer || '';
        
        var extractedTransactionCard = Utils.extractJsonFromText(answerText, 'type');
        var extraction = Utils.extractAndRemoveJson(answerText, 'type');
        answerText = extraction.cleanedText;
        
        // Build blocks-format response
        var richContentBlocks = [];
        
        // Add text as first block
        if (answerText && answerText.trim()) {
            richContentBlocks.push({ type: 'text', content: answerText });
        }
        
        var tablesToShow = finalAnswer.tables_to_show || [];
        
        // Include both query and execute_template results
        var queryResults = toolResults.filter(function(tr) { 
            return (tr.tool === 'query' || tr.tool === 'execute_template') && tr.result && tr.result.success; 
        });
        var lastQueryResult = queryResults[queryResults.length - 1];
        
        if (lastQueryResult && lastQueryResult.result && lastQueryResult.result.rowCount === 1 && QueryExecution.isSingleTransactionResult(lastQueryResult.result, message)) {
            var row = lastQueryResult.result.rows[0];
            var cardData = QueryExecution.buildTransactionCardData(row, lastQueryResult.result.columns);
            richContentBlocks.push({
                type: 'transaction_card',
                transactionType: QueryExecution.detectTransactionType(row, lastQueryResult.purpose),
                data: cardData
            });
        } else if (extractedTransactionCard) {
            richContentBlocks.push({
                type: 'transaction_card',
                transactionType: extractedTransactionCard.trantype || 'Transaction',
                data: extractedTransactionCard
            });
        } else {
            toolResults.forEach(function(tr) {
                if ((tr.tool === 'query' || tr.tool === 'execute_template') && tr.result && tr.result.success && tr.result.rows && tr.result.rows.length > 0) {
                    if (tablesToShow.length === 0 || tablesToShow.includes(tr.step)) {
                        var tableItem = {
                            type: 'table',
                            title: tr.purpose || tr.template_id || 'Results',
                            columns: tr.result.columns,
                            rows: tr.result.rows.slice(0, 200)
                        };
                        
                        // Apply template's resultFormat if available
                        if (tr.templateFormat) {
                            var fmt = tr.templateFormat;
                            
                            // Apply pivot transformation FIRST if enabled
                            if (fmt.pivotConfig && fmt.pivotConfig.enabled) {
                                var pivotResult = Utils.applyPivotTransformation(tr.result.rows, tr.result.columns, fmt.pivotConfig);
                                if (pivotResult.pivotApplied) {
                                    tableItem.rows = pivotResult.rows.slice(0, 500);
                                    tableItem.columns = pivotResult.columns;
                                    if (pivotResult.groupBy) {
                                        tableItem.groupBy = pivotResult.groupBy;
                                    }
                                    tableItem.showSubtotals = true;
                                }
                            }
                            
                            if (fmt.variant) tableItem.variant = fmt.variant;
                            if (fmt.groupBy && !tableItem.groupBy) tableItem.groupBy = fmt.groupBy;
                            if (fmt.calculatedTotals) tableItem.calculatedTotals = fmt.calculatedTotals;
                            if (fmt.formatting) tableItem.formatting = fmt.formatting;
                            if (fmt.sections) tableItem.sections = fmt.sections;
                            if (fmt.pivotConfig) tableItem.pivotConfig = fmt.pivotConfig;
                        }
                        
                        richContentBlocks.push(tableItem);
                    }
                }
            });
        }
        
        var response = ResponseBuilder.buildResponse('', steps, startTime, {
            model: aiResult.model,
            provider: aiResult.provider
        });
        
        response.richContent = richContentBlocks;
        response.blocksFormat = true;
        
        if (finalAnswer.key_findings && finalAnswer.key_findings.length) {
            response.keyFindings = finalAnswer.key_findings;
        }
        
        return response;
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // buildFallbackResponse - Updated to use blocks format
    // ═══════════════════════════════════════════════════════════════════════════════
    function buildFallbackResponse(message, toolResults, steps, startTime, fiscalContext) {
        var queryResults = toolResults.filter(function(tr) {
            return (tr.tool === 'query' || tr.tool === 'execute_template') && tr.result && tr.result.success;
        });
        var lastQueryResult = queryResults[queryResults.length - 1];
        
        // Build blocks-format response
        var richContentBlocks = [];
        
        if (lastQueryResult && lastQueryResult.result && lastQueryResult.result.rowCount === 1 && QueryExecution.isSingleTransactionResult(lastQueryResult.result, message)) {
            var row = lastQueryResult.result.rows[0];
            var cardData = QueryExecution.buildTransactionCardData(row, lastQueryResult.result.columns);
            var txnType = QueryExecution.detectTransactionType(row, lastQueryResult.purpose || lastQueryResult.template_id || message);
            
            var text = 'Found the ' + txnType.toLowerCase();
            if (cardData.tranid) text += ' **' + cardData.tranid + '**';
            if (cardData.entity) text += ' for ' + cardData.entity;
            if (cardData.date) text += ' dated ' + cardData.date;
            if (cardData.amount) text += ' for ' + (typeof cardData.amount === 'number' ? '$' + cardData.amount.toLocaleString() : cardData.amount);
            text += '.';
            
            richContentBlocks.push({ type: 'text', content: text });
            richContentBlocks.push({
                type: 'transaction_card',
                transactionType: txnType,
                data: cardData
            });
            
            var response = ResponseBuilder.buildResponse('', steps, startTime, AIProviders.getCurrentModelInfo());
            response.richContent = richContentBlocks;
            response.blocksFormat = true;
            return response;
        }
        
        var text = "Here's what I found:\n\n";
        
        toolResults.forEach(function(tr) {
            if (tr.tool === 'query' && tr.result && tr.result.success) {
                text += '• ' + tr.purpose + ': ' + tr.result.rowCount + ' result' + (tr.result.rowCount !== 1 ? 's' : '') + '\n';
            } else if (tr.tool === 'execute_template' && tr.result && tr.result.success) {
                var label = tr.purpose || tr.template_id || 'Template query';
                var fiscalInfo = tr.parameters && tr.parameters.fiscal_year ? ' (' + tr.parameters.fiscal_year + ')' : '';
                text += '• ' + label + fiscalInfo + ': ' + tr.result.rowCount + ' result' + (tr.result.rowCount !== 1 ? 's' : '') + '\n';
            } else if ((tr.tool === 'dashboard' || tr.tool === 'get_dashboard_data') && tr.result && tr.result.success) {
                text += '• ' + tr.dashboard + ' dashboard data retrieved\n';
            }
        });
        
        if (queryResults.length === 0) {
            text += "\n_No query results were retrieved._\n";
        }
        
        // Add text as first block
        richContentBlocks.push({ type: 'text', content: text });
        
        // Add tables for each query result
        toolResults.forEach(function(tr) {
            if (tr.tool === 'query' && tr.result && tr.result.success && tr.result.rows && tr.result.rows.length > 0) {
                richContentBlocks.push({
                    type: 'table',
                    title: tr.purpose,
                    columns: tr.result.columns,
                    rows: tr.result.rows.slice(0, 200)
                });
            } else if (tr.tool === 'execute_template' && tr.result && tr.result.success && tr.result.rows && tr.result.rows.length > 0) {
                var fiscalInfo = tr.parameters && tr.parameters.fiscal_year ? ' (' + tr.parameters.fiscal_year + ')' : '';
                var tableItem = {
                    type: 'table',
                    title: (tr.purpose || tr.result.templateName || tr.template_id) + fiscalInfo,
                    columns: tr.result.columns,
                    rows: tr.result.rows.slice(0, 200)
                };
                
                // Apply template's resultFormat if available
                if (tr.templateFormat) {
                    var fmt = tr.templateFormat;
                    
                    // Apply pivot transformation FIRST if enabled
                    if (fmt.pivotConfig && fmt.pivotConfig.enabled) {
                        var pivotResult = Utils.applyPivotTransformation(tr.result.rows, tr.result.columns, fmt.pivotConfig);
                        if (pivotResult.pivotApplied) {
                            tableItem.rows = pivotResult.rows.slice(0, 500);
                            tableItem.columns = pivotResult.columns;
                            if (pivotResult.groupBy) {
                                tableItem.groupBy = pivotResult.groupBy;
                            }
                            tableItem.showSubtotals = true;
                        }
                    }
                    
                    if (fmt.variant) tableItem.variant = fmt.variant;
                    if (fmt.groupBy && !tableItem.groupBy) tableItem.groupBy = fmt.groupBy;
                    if (fmt.calculatedTotals) tableItem.calculatedTotals = fmt.calculatedTotals;
                    if (fmt.formatting) tableItem.formatting = fmt.formatting;
                    if (fmt.sections) tableItem.sections = fmt.sections;
                    if (fmt.pivotConfig) tableItem.pivotConfig = fmt.pivotConfig;
                }
                
                richContentBlocks.push(tableItem);
            }
        });
        
        var response = ResponseBuilder.buildResponse('', steps, startTime, AIProviders.getCurrentModelInfo());
        response.richContent = richContentBlocks;
        response.blocksFormat = true;
        
        // Attach debug log if enabled
        if (Utils.isDebugMode()) {
            response._agentDebugLog = getAndClearAgentDebugLog();
        }
        
        return response;
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // executeAgenticPlan - EXACT copy from original line 2139 (897 lines)
    // ═══════════════════════════════════════════════════════════════════════════════
    function executeAgenticPlan(message, plan, history, fiscalContext, steps, startTime, sessionContext) {
        // Add +4 buffer for: potential retries (2), synthesis (1), and buffer (1)
        // This prevents premature termination when queries fail and need retry
        var MAX_ITERATIONS = Math.min((plan.estimated_queries || 3) + 4, MAX_AGENT_ITERATIONS);
        var toolResults = [];
        
        // ═══════════════════════════════════════════════════════════════
        // DEDUPLICATION TRACKING - Prevent repeated failing tool calls
        // ═══════════════════════════════════════════════════════════════
        var failedSchemaRequests = {};  // Track schemas that failed to load { recordType: failCount }
        var successfulSchemas = {};     // Track schemas already loaded { recordType: summary }
        var repeatedToolCalls = {};     // Track repeated tool calls to detect loops
        var MAX_REPEATED_FAILURES = 1;  // Block immediately after FIRST failure (don't waste time retrying)
        
        var resolvedEntities = sessionContext && sessionContext.resolvedEntities ? sessionContext.resolvedEntities : {};
        
        if (plan.entities_to_resolve && Array.isArray(plan.entities_to_resolve) && plan.entities_to_resolve.length > 0) {
            // Filter out date expressions - these should never be resolved as entities
            var DATE_PATTERNS = /^(this|last|next|current|previous)\s*(year|month|quarter|week|day|fy|fiscal)s?$/i;
            var DATE_KEYWORDS = ['ytd', 'mtd', 'qtd', 'yoy', 'mom', 'qoq', 'today', 'yesterday', 'tomorrow',
                                  'q1', 'q2', 'q3', 'q4', 'fy25', 'fy24', 'fy2025', 'fy2024', 'fiscal year',
                                  '2024', '2025', '2023', 'january', 'february', 'march', 'april', 'may', 'june',
                                  'july', 'august', 'september', 'october', 'november', 'december'];
            
            var filteredEntities = plan.entities_to_resolve.filter(function(entity) {
                var term = (entity.term || '').toLowerCase().trim();
                // Skip if matches date pattern
                if (DATE_PATTERNS.test(term)) {
                    log.debug('Skipping date expression in entity resolution', { term: term });
                    return false;
                }
                // Skip if in date keywords list
                if (DATE_KEYWORDS.indexOf(term) >= 0) {
                    log.debug('Skipping date keyword in entity resolution', { term: term });
                    return false;
                }
                return true;
            });
            
            var unresolved = filteredEntities.filter(function(entity) {
                var termLower = (entity.term || '').toLowerCase();
                var alreadyInContext = resolvedEntities[termLower] && resolvedEntities[termLower].id;
                if (alreadyInContext) {
                    toolResults.push({
                        step: 0,
                        tool: 'resolve_entity',
                        term: entity.term,
                        entityType: entity.entity_type,
                        result: { 
                            resolved: true, 
                            id: resolvedEntities[termLower].id,
                            name: resolvedEntities[termLower].name,
                            fromContext: true 
                        }
                    });
                }
                return !alreadyInContext;
            });
            
            if (unresolved.length > 0) {
                steps.push({
                    type: 'entity_resolution',
                    title: 'Resolving entities: ' + unresolved.map(function(e) { return e.term; }).join(', '),
                    status: 'running',
                    timestamp: Date.now()
                });
                
                for (var idx = 0; idx < unresolved.length; idx++) {
                    var entity = unresolved[idx];
                    var resolution = EntityResolver.executeEntityResolution(entity);
                    toolResults.push({
                        step: 0,
                        tool: 'resolve_entity',
                        term: entity.term,
                        entityType: entity.entity_type,
                        result: resolution
                    });
                    
                    if (resolution.resolved && resolution.id && entity.term) {
                        resolvedEntities[entity.term.toLowerCase()] = {
                            type: entity.entity_type,
                            id: resolution.id,
                            name: resolution.name || entity.term
                        };
                    }
                }
                
                var resolvedCount = toolResults.filter(function(r) { return r.result && r.result.resolved && !r.result.fromContext; }).length;
                var contentParts = toolResults
                    .filter(function(r) { return r.tool === 'resolve_entity' && !(r.result && r.result.fromContext); })
                    .map(function(r) {
                        if (r.result && r.result.resolved) {
                            return '✓ "' + r.term + '" → ' + r.result.name + ' (ID: ' + r.result.id + ')';
                        } else if (r.result && r.result.notFound) {
                            var suggestions = r.result.suggestions ? r.result.suggestions.slice(0, 3).map(function(s) { return s.name; }).join(', ') : '';
                            return '✗ "' + r.term + '" not found' + (suggestions ? '. Similar: ' + suggestions : '');
                        } else if (r.result && r.result.ambiguous) {
                            return '? "' + r.term + '" ambiguous: ' + (r.result.options ? r.result.options.slice(0,3).map(function(o) { return o.name; }).join(', ') : '');
                        }
                        return '"' + r.term + '" - ' + (r.result && r.result.message ? r.result.message : 'unknown');
                    });
                
                steps[steps.length - 1].status = 'complete';
                steps[steps.length - 1].resolved = resolvedCount + '/' + unresolved.length + ' resolved';
                steps[steps.length - 1].content = contentParts.join('\n');
            }
        }
        
        var updatedSessionContext = Planning.updateSessionContext(sessionContext, {
            resolvedEntities: resolvedEntities
        });
        
        var agentSystemPrompt = Prompts.buildAgentSystemPrompt(fiscalContext, plan);
        
        // ═══════════════════════════════════════════════════════════════════════════════
        // WORKING MEMORY - Persistent cognitive state for adaptive intelligence
        // ═══════════════════════════════════════════════════════════════════════════════
        var workingMemory = AdaptiveIntelligence.createWorkingMemory(message, plan);
        
        // Track context for reflection triggers
        var reflectionContext = {
            workingMemory: workingMemory,
            lastQueryResult: null,
            lastQueryPurpose: null,
            hypothesisContradicted: false,
            newEntityDiscovered: false,
            comparisonContext: null
        };
        
        var autoQueryCount = 0;
        var MAX_AUTO_QUERIES = 2;
        
        var errorCounts = {};
        var ESCALATION_THRESHOLD = 2;
        var currentTier = 2;
        
        // Track consecutive text responses (model failing to use tools)
        var consecutiveTextResponses = 0;
        var TEXT_RESPONSE_ESCALATION_THRESHOLD = 2; // Escalate to tier 3 after 2 consecutive text responses
        
        // Duplicate query detection - prevent LLM from retrying the same failed query
        var executedQueryHashes = {};
        var DUPLICATE_QUERY_THRESHOLD = 2; // Allow same query to be tried twice max
        
        // Track successful query purposes - skip if same purpose already succeeded
        var successfulQueryPurposes = {};
        
        // Track when LLM ignores "all steps complete" and keeps querying
        var allStepsCompleteIgnoredCount = 0;
        
        // Purpose-based failure tracking - skip steps that fail repeatedly
        var purposeFailures = {};
        var skippedPurposes = [];
        
        /**
         * Check if a purpose should be skipped due to repeated failures
         */
        function shouldSkipPurpose(purpose) {
            if (!purpose) return false;
            var normalizedPurpose = purpose.toLowerCase().trim();
            return (purposeFailures[normalizedPurpose] || 0) >= MAX_PURPOSE_FAILURES;
        }
        
        /**
         * Record a failure for a purpose
         */
        function recordPurposeFailure(purpose) {
            if (!purpose) return;
            var normalizedPurpose = purpose.toLowerCase().trim();
            purposeFailures[normalizedPurpose] = (purposeFailures[normalizedPurpose] || 0) + 1;
            
            if (purposeFailures[normalizedPurpose] >= MAX_PURPOSE_FAILURES) {
                skippedPurposes.push(purpose);
                log.audit('Skipping step due to repeated failures', {
                    purpose: purpose,
                    failureCount: purposeFailures[normalizedPurpose]
                });
            }
        }
        
        /**
         * Simple hash function for query deduplication
         */
        function hashQuery(sql) {
            if (!sql) return '';
            // Normalize: lowercase, collapse whitespace, trim
            var normalized = sql.toLowerCase().replace(/\s+/g, ' ').trim();
            // Simple hash (djb2 variant)
            var hash = 5381;
            for (var i = 0; i < normalized.length; i++) {
                hash = ((hash << 5) + hash) + normalized.charCodeAt(i);
                hash = hash & hash; // Convert to 32-bit integer
            }
            return 'q' + Math.abs(hash).toString(16);
        }
        
        /**
         * Normalize a purpose string for comparison
         */
        function normalizePurpose(purpose) {
            if (!purpose) return '';
            return purpose.toLowerCase().replace(/\s+/g, ' ').trim();
        }
        
        /**
         * Check if a purpose has already succeeded
         */
        function hasPurposeSucceeded(purpose) {
            if (!purpose) return false;
            return !!successfulQueryPurposes[normalizePurpose(purpose)];
        }
        
        /**
         * Record a successful purpose
         */
        function recordSuccessfulPurpose(purpose) {
            if (!purpose) return;
            successfulQueryPurposes[normalizePurpose(purpose)] = true;
        }
        
        for (var iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
            var govCheck = Utils.checkGovernance(GOVERNANCE_THRESHOLD_LLM);
            if (!govCheck.hasEnough) {
                log.audit('Agent stopping due to low governance', { 
                    iteration: iteration, 
                    remaining: govCheck.remaining,
                    toolResults: toolResults.length 
                });
                var debugLog = Utils.isDebugMode() ? getAndClearAgentDebugLog() : null;
                var partialResponse = Utils.buildPartialResponse(toolResults, steps, startTime, 'low governance units', debugLog);
                partialResponse.sessionContext = updatedSessionContext;
                return partialResponse;
            }
            
            var planStep = plan.plan && plan.plan[iteration];
            var stepPurpose = planStep ? planStep.purpose : 'Processing...';
            
            // Skip resolve_entity steps - entities are already resolved upfront by orchestrator
            // Guard against infinite loop if plan contains only resolve_entity steps
            if (planStep && planStep.action === 'resolve_entity') {
                // Count how many resolve_entity steps we've skipped consecutively
                var consecutiveSkips = 0;
                for (var skipIdx = 0; skipIdx <= iteration && skipIdx < (plan.plan || []).length; skipIdx++) {
                    if (plan.plan[skipIdx] && plan.plan[skipIdx].action === 'resolve_entity') {
                        consecutiveSkips++;
                    } else {
                        break; // Reset if we hit a non-resolve step
                    }
                }
                
                // If all plan steps so far are resolve_entity, check if there are any non-resolve steps
                var hasNonResolveSteps = (plan.plan || []).some(function(s) { 
                    return s && s.action !== 'resolve_entity'; 
                });
                
                if (!hasNonResolveSteps) {
                    log.error('Plan contains only resolve_entity steps - malformed plan', {
                        planSteps: plan.plan,
                        iteration: iteration
                    });
                    addAgentDebug('MALFORMED_PLAN: Only resolve_entity steps', { 
                        planSteps: plan.plan 
                    });
                    // Return error response instead of spinning forever
                    return {
                        text: 'I apologize, but I encountered an issue processing your request. Please try rephrasing your question.',
                        error: true,
                        errorMessage: 'Malformed plan: only resolve_entity steps',
                        steps: steps,
                        duration: Date.now() - startTime,
                        debugLog: getAndClearAgentDebugLog()
                    };
                }
                
                addAgentDebug('Skipping resolve_entity step', {
                    iteration: iteration,
                    reason: 'Entities already resolved by orchestrator',
                    resolvedEntities: Object.keys(resolvedEntities)
                });
                continue;
            }
            
            steps.push({
                type: 'agent_step',
                title: stepPurpose,
                status: 'running',
                timestamp: Date.now()
            });
            
            var agentPrompt = buildAgentPrompt(message, plan, toolResults, iteration, workingMemory, skippedPurposes);
            
            // Update working memory iteration counter
            workingMemory.currentIteration = iteration;
            
            addAgentDebug('Before AI call', {
                iteration: iteration,
                promptLength: agentPrompt.length,
                toolResultsCount: toolResults.length,
                resolvedEntitiesKeys: Object.keys(resolvedEntities)
            });
            
            try {
                log.debug('AGENT_DEBUG: Before AI call', { iteration: iteration, promptLength: agentPrompt.length });
                
                var result = AIProviders.callAI(agentPrompt, {
                    systemPrompt: agentSystemPrompt,
                    chatHistory: history,
                    tools: ToolDefinitions.getAgentToolsForPlan(plan),
                    maxTokens: DEFAULT_MAX_TOKENS,
                    temperature: 0.2,
                    purpose: stepPurpose,
                    tier: currentTier
                });
                
                log.debug('AGENT_DEBUG: After AI call', { 
                    iteration: iteration, 
                    resultType: result.type,
                    hasToolCalls: !!(result.toolCalls && result.toolCalls.length),
                    toolCallCount: result.toolCalls ? result.toolCalls.length : 0,
                    firstToolName: result.toolCalls && result.toolCalls[0] ? result.toolCalls[0].name : 'none'
                });
                
                addAgentDebug('After AI call', {
                    iteration: iteration,
                    resultType: result.type,
                    hasToolCalls: !!(result.toolCalls && result.toolCalls.length),
                    toolCallCount: result.toolCalls ? result.toolCalls.length : 0,
                    firstToolName: result.toolCalls && result.toolCalls[0] ? result.toolCalls[0].name : 'none'
                });
                
                steps[steps.length - 1].status = 'complete';
                
                if (result.type === 'tool_call' && result.toolCalls && result.toolCalls.length > 0) {
                    // Reset text response counter since we got a tool call
                    consecutiveTextResponses = 0;
                    
                    // Check if allStepsComplete was true - if LLM sent a query instead of final_response, count it
                    var wasAllStepsComplete = buildAgentPrompt(message, plan, toolResults, iteration, workingMemory, skippedPurposes).indexOf('ALL PLAN STEPS COMPLETE') > -1;
                    
                    // Separate tool calls: queries/tools vs final_response
                    var pendingFinalResponse = null;
                    var queryToolCalls = [];
                    
                    for (var tcIdx = 0; tcIdx < result.toolCalls.length; tcIdx++) {
                        var tc = result.toolCalls[tcIdx];
                        if (tc.name === 'final_answer' || tc.name === 'final_response') {
                            pendingFinalResponse = tc;
                        } else {
                            queryToolCalls.push(tc);
                        }
                    }
                    
                    // Log multi-tool-call scenario
                    if (result.toolCalls.length > 1) {
                        addAgentDebug('Multiple tool calls received', {
                            total: result.toolCalls.length,
                            queries: queryToolCalls.length,
                            hasFinalResponse: !!pendingFinalResponse
                        });
                    }
                    
                    // If allStepsComplete but LLM sent queries instead of final_response, track it
                    if (wasAllStepsComplete && queryToolCalls.length > 0 && !pendingFinalResponse) {
                        allStepsCompleteIgnoredCount++;
                        addAgentDebug('LLM ignored allStepsComplete', {
                            ignoreCount: allStepsCompleteIgnoredCount,
                            threshold: MAX_SYNTHESIS_IGNORES
                        });
                        
                        // Force synthesis if LLM ignores too many times
                        if (allStepsCompleteIgnoredCount >= MAX_SYNTHESIS_IGNORES) {
                            log.audit('Forcing synthesis - LLM ignored allStepsComplete too many times', {
                                ignoreCount: allStepsCompleteIgnoredCount,
                                toolResultsCount: toolResults.length
                            });
                            addAgentDebug('FORCING_SYNTHESIS', {
                                reason: 'LLM ignored allStepsComplete ' + allStepsCompleteIgnoredCount + ' times',
                                toolResultsCount: toolResults.length
                            });
                            
                            // Build a synthetic final response from collected data
                            var forcedResponse = buildFallbackResponse(message, toolResults, steps, startTime, fiscalContext);
                            forcedResponse.sessionContext = updatedSessionContext;
                            forcedResponse._forcedSynthesis = true;
                            return forcedResponse;
                        }
                    }
                    
                    // Process all query tool calls
                    for (var qIdx = 0; qIdx < queryToolCalls.length; qIdx++) {
                        var toolCall = queryToolCalls[qIdx];
                    
                    // DEBUG: Log full tool call details
                    log.debug('AGENT_DEBUG: Tool call received', {
                        toolName: toolCall.name,
                        hasArguments: !!toolCall.arguments,
                        argumentKeys: toolCall.arguments ? Object.keys(toolCall.arguments) : [],
                        argumentsRaw: JSON.stringify(toolCall.arguments).substring(0, 500)
                    });
                    
                    addAgentDebug('Tool call received', {
                        toolName: toolCall.name,
                        hasArguments: !!toolCall.arguments,
                        argumentKeys: toolCall.arguments ? Object.keys(toolCall.arguments) : [],
                        argumentsPreview: JSON.stringify(toolCall.arguments).substring(0, 300)
                    });
                    
                    if (toolCall.name === 'execute_query') {
                        var queryArgs = toolCall.arguments;
                        
                        // Check if this purpose already succeeded - skip if so
                        if (hasPurposeSucceeded(queryArgs.purpose)) {
                            addAgentDebug('SKIPPING_DUPLICATE_PURPOSE', {
                                purpose: queryArgs.purpose,
                                reason: 'This purpose already has successful results'
                            });
                            continue; // Skip this query, move to next tool call
                        }
                        
                        // Duplicate query detection
                        var qHash = hashQuery(queryArgs.query);
                        executedQueryHashes[qHash] = (executedQueryHashes[qHash] || 0) + 1;
                        
                        var queryResult;
                        if (executedQueryHashes[qHash] > DUPLICATE_QUERY_THRESHOLD) {
                            // This exact query has been tried too many times
                            log.audit('Duplicate query detected, forcing different approach', {
                                hash: qHash,
                                count: executedQueryHashes[qHash],
                                queryPreview: (queryArgs.query || '').substring(0, 100)
                            });
                            addAgentDebug('DUPLICATE_QUERY_BLOCKED', {
                                hash: qHash,
                                count: executedQueryHashes[qHash],
                                query: queryArgs.query
                            });
                            
                            // Return synthetic error to force LLM to try different approach
                            queryResult = {
                                success: false,
                                error: 'This exact query has already been tried ' + (executedQueryHashes[qHash] - 1) + ' times and failed. You MUST try a DIFFERENT approach - modify the query structure, try different tables, or use a template instead.',
                                retryGuidance: 'Do NOT retry the same query. Try: 1) Different table joins, 2) Different filters, 3) A template if available, 4) Simpler query structure.',
                                duplicate: true
                            };
                        } else {
                            queryResult = executeAgentQuery(queryArgs, fiscalContext);
                        }
                        
                        var stepContent = '';
                        if (queryResult.success) {
                            stepContent = 'Found ' + queryResult.rowCount + ' result' + (queryResult.rowCount !== 1 ? 's' : '');
                            if (queryResult.columns && queryResult.columns.length > 0) {
                                stepContent += '\nColumns: ' + queryResult.columns.join(', ');
                            }
                            if (queryResult.rowCount > 0 && queryResult.rows) {
                                var sampleRows = queryResult.rows.slice(0, 3);
                                stepContent += '\nSample: ' + JSON.stringify(sampleRows).substring(0, 200);
                            }
                            if (queryResult.rowCount === 0) {
                                stepContent += '\n⚠️ No results - verify filters, date ranges, and entity references';
                            }
                        } else {
                            stepContent = 'Query failed: ' + queryResult.error;
                            if (queryResult.retryGuidance) {
                                stepContent += '\nGuidance: ' + queryResult.retryGuidance;
                            }
                            
                            var errorKey = queryResult.error || 'unknown_error';
                            errorCounts[errorKey] = (errorCounts[errorKey] || 0) + 1;
                            
                            // Track purpose-based failures
                            recordPurposeFailure(queryArgs.purpose);
                            var isRepeatedFailure = shouldSkipPurpose(queryArgs.purpose);
                            
                            // Detect date syntax error
                            var hasBetweenWithStringDates = /BETWEEN\s+['"][0-9]{4}-[0-9]{2}-[0-9]{2}['"]/.test(queryArgs.query);
                            var hasDateCompareWithStringDates = /(>=|<=|>|<|=)\s*['"][0-9]{4}-[0-9]{2}-[0-9]{2}['"]/.test(queryArgs.query);
                            var hasDateSyntaxError = (hasBetweenWithStringDates || hasDateCompareWithStringDates) && 
                                                     !queryArgs.query.toUpperCase().includes('TO_DATE');
                            
                            // Update reflection context for adaptive intelligence
                            reflectionContext.lastQueryResult = queryResult;
                            reflectionContext.lastQueryPurpose = queryArgs.purpose;
                            reflectionContext.repeatedFailure = isRepeatedFailure;
                            reflectionContext.dateSyntaxError = hasDateSyntaxError;
                            
                            // Record anomaly in working memory
                            var anomalyType = hasDateSyntaxError ? 'date_syntax_error' : 
                                             (isRepeatedFailure ? 'repeated_query_failure' : 'query_failure');
                            var anomalyDesc = hasDateSyntaxError ? 
                                'Query used bare string dates instead of TO_DATE() - fix: ' + queryResult.retryGuidance :
                                'Query failed: ' + queryResult.error;
                            AdaptiveIntelligence.recordAnomaly(workingMemory, anomalyType, anomalyDesc, 'high');
                            
                            // Check reflection triggers - this is the key integration!
                            var triggerCheck = AdaptiveIntelligence.shouldForceReflection(workingMemory, reflectionContext);
                            
                            // Handle reflection exhaustion (same issues detected repeatedly)
                            if (triggerCheck.reflectionExhausted) {
                                log.audit('Reflection exhausted - forcing synthesis', {
                                    reason: triggerCheck.reason,
                                    iteration: iteration,
                                    triggers: triggerCheck.triggers.map(function(t) { return t.id; })
                                });
                                
                                // Add guidance to proceed to final response
                                stepContent += '\n\n⚠️ REFLECTION EXHAUSTED: Same issues detected multiple times.';
                                stepContent += '\n→ Proceed to final_response with whatever data you have collected.';
                                stepContent += '\n→ Explain any limitations or missing data in your response.';
                                
                                // Mark in queryResult so prompt builder sees it
                                queryResult.reflectionExhausted = true;
                                queryResult.reflectionHint = '⚠️ REFLECTION EXHAUSTED: You have already reflected on this issue. Do NOT call reflect_and_adapt again. Instead, call final_response now with whatever data you have, and explain any limitations.';
                            } else if (triggerCheck.force) {
                                var triggerNames = triggerCheck.triggers.map(function(t) { return t.name; }).join(', ');
                                workingMemory.triggeredReflections.push({
                                    iteration: iteration,
                                    triggers: triggerCheck.triggers,
                                    reason: triggerCheck.reason
                                });
                                
                                // Build reflection hint - this gets added to BOTH stepContent (for UI) AND queryResult (for LLM prompt)
                                var reflectionHint = '🤔 REFLECTION REQUIRED: ' + triggerCheck.reason;
                                reflectionHint += '\nTriggered by: ' + triggerNames;
                                reflectionHint += '\n\n→ You MUST call reflect_and_adapt to handle this failure:';
                                reflectionHint += '\n  - analysis: Explain why the query failed';
                                reflectionHint += '\n  - plan_assessment: "needs_modification"';
                                reflectionHint += '\n  - plan_modifications: [{ action: "add_query", reason: "Retry with corrected SQL" }]';
                                reflectionHint += '\n  - next_immediate_action: "execute_new_query"';
                                reflectionHint += '\n  - immediate_query: { sql: "...corrected query...", purpose: "' + (queryArgs.purpose || 'Retry query') + '" }';
                                
                                if (hasDateSyntaxError) {
                                    reflectionHint += '\n\n⚠️ DATE FIX REQUIRED: Your query used bare string dates. Fix by wrapping ALL dates with TO_DATE():';
                                    reflectionHint += '\n   WRONG:   BETWEEN \'2024-04-01\' AND \'2025-03-31\'';
                                    reflectionHint += '\n   CORRECT: >= TO_DATE(\'2024-04-01\', \'YYYY-MM-DD\') AND < TO_DATE(\'2025-04-01\', \'YYYY-MM-DD\')';
                                }
                                
                                // Add to stepContent for UI display
                                stepContent += '\n\n' + reflectionHint;
                                
                                // CRITICAL: Add to queryResult so it's included in the LLM prompt
                                queryResult.reflectionHint = reflectionHint;
                            }
                            
                            // If this purpose has failed too many times, add skip guidance
                            if (isRepeatedFailure) {
                                stepContent += '\n⚠️ This step has failed ' + MAX_PURPOSE_FAILURES + ' times. Use reflect_and_adapt to skip this step and proceed.';
                            }
                            
                            if (errorCounts[errorKey] >= ESCALATION_THRESHOLD && currentTier < 3) {
                                currentTier = 3;
                                log.audit('Auto-escalating to tier 3 due to repeated errors', {
                                    error: errorKey,
                                    count: errorCounts[errorKey],
                                    iteration: iteration
                                });
                                stepContent += '\n🔄 Escalating to premium model for better SQL generation...';
                            }
                        }
                        
                        toolResults.push({
                            step: iteration + 1,
                            tool: 'query',
                            purpose: queryArgs.purpose,
                            query: queryArgs.query,
                            queryLimit: parseQueryLimit(queryArgs.query),
                            result: queryResult
                        });
                        
                        steps[steps.length - 1].title = queryArgs.purpose || (planStep ? planStep.purpose : null) || 'Query data';
                        steps[steps.length - 1].content = stepContent;
                        steps[steps.length - 1].sql = queryArgs.query;
                        steps[steps.length - 1].rowCount = queryResult.rowCount;
                        steps[steps.length - 1].columns = queryResult.columns;
                        steps[steps.length - 1].sampleData = queryResult.rows ? queryResult.rows.slice(0, 3) : [];
                        steps[steps.length - 1].toolName = 'execute_query';
                        steps[steps.length - 1].toolArgs = {
                            query: queryArgs.query,
                            purpose: queryArgs.purpose
                        };
                        if (!queryResult.success) {
                            steps[steps.length - 1].error = queryResult.error;
                            steps[steps.length - 1].retryGuidance = queryResult.retryGuidance;
                        }
                        
                        // Check if we can auto-return without synthesis
                        if (queryResult.success) {
                            // Record this purpose as successful to prevent duplicate queries
                            recordSuccessfulPurpose(queryArgs.purpose);
                            
                            // Update working memory with collected data
                            workingMemory.collectedData.push({
                                stepNumber: iteration + 1,
                                type: 'query',
                                summary: queryArgs.purpose || 'Query',
                                rowCount: queryResult.rowCount,
                                keyValues: queryResult.rows ? queryResult.rows.slice(0, 2) : []
                            });
                            
                            // Update reflection context and check for anomalies
                            reflectionContext.lastQueryResult = queryResult;
                            reflectionContext.lastQueryPurpose = queryArgs.purpose;
                            
                            // Check for zero rows anomaly
                            if (queryResult.rowCount === 0) {
                                AdaptiveIntelligence.recordAnomaly(
                                    workingMemory, 
                                    'zero_rows', 
                                    'Query "' + (queryArgs.purpose || 'unknown') + '" returned 0 rows',
                                    'high'
                                );
                            }
                            
                            // Check reflection triggers
                            var triggerCheck = AdaptiveIntelligence.shouldForceReflection(workingMemory, reflectionContext);
                            
                            // Handle reflection exhaustion (same issues detected repeatedly)
                            if (triggerCheck.reflectionExhausted) {
                                addAgentDebug('Reflection exhausted on success path', {
                                    reason: triggerCheck.reason,
                                    iteration: iteration
                                });
                                
                                // Add hint to proceed to final response
                                toolResults.push({
                                    step: iteration + 1,
                                    tool: 'system_hint',
                                    message: '⚠️ REFLECTION EXHAUSTED: Same issues detected multiple times. Proceed to final_response with available data and note any limitations.'
                                });
                            } else if (triggerCheck.force && iteration < MAX_ITERATIONS - 2) {
                                workingMemory.triggeredReflections.push({
                                    iteration: iteration,
                                    triggers: triggerCheck.triggers,
                                    reason: triggerCheck.reason
                                });
                                
                                addAgentDebug('Reflection triggered', {
                                    reason: triggerCheck.reason,
                                    triggers: triggerCheck.triggers.map(function(t) { return t.name; })
                                });
                                
                                // Add hint for model to reflect
                                toolResults.push({
                                    step: iteration + 1,
                                    tool: 'system_hint',
                                    message: '🤔 REFLECTION RECOMMENDED: ' + triggerCheck.reason + '. Consider using deep_think or reflect_and_adapt tool to analyze findings before continuing.'
                                });
                            }
                            
                            var autoResponse = tryAutoReturn(plan, toolResults, resolvedEntities, fiscalContext, steps, startTime, result, queryArgs.purpose || 'Query Results');
                            if (autoResponse) {
                                autoResponse.sessionContext = updatedSessionContext;
                                return autoResponse;
                            }
                        }
                        
                        continue;
                    }
                    
                    if (toolCall.name === 'get_dashboard_data') {
                        var dashData = DashboardHandler.executeAgentDashboard(toolCall.arguments, fiscalContext);
                        
                        // Count actual data points more accurately
                        var dataDescription = 'unknown structure';
                        if (dashData.data) {
                            var topKeys = Object.keys(dashData.data);
                            var totalItems = 0;
                            topKeys.forEach(function(k) {
                                var val = dashData.data[k];
                                if (Array.isArray(val)) totalItems += val.length;
                                else if (typeof val === 'object' && val !== null) totalItems += Object.keys(val).length;
                                else totalItems += 1;
                            });
                            dataDescription = topKeys.length + ' sections, ~' + totalItems + ' data points';
                        }
                        
                        steps.push({
                            type: 'tool',
                            title: 'Loading ' + toolCall.arguments.dashboard + ' dashboard',
                            status: dashData.success ? 'complete' : 'error',
                            content: dashData.success 
                                ? 'Retrieved ' + toolCall.arguments.dashboard + ' data (' + dataDescription + ')'
                                : 'Failed: ' + dashData.error,
                            timestamp: Date.now()
                        });
                        
                        toolResults.push({
                            step: iteration + 1,
                            tool: 'get_dashboard_data',
                            dashboard: toolCall.arguments.dashboard,
                            focus: toolCall.arguments.focus,
                            result: dashData
                        });
                        continue;
                    }
                    
                    if (toolCall.name === 'execute_template') {
                        var templateArgs = toolCall.arguments;
                        var originalParams = JSON.parse(JSON.stringify(templateArgs.parameters || {}));
                        var templateResult = QueryExecution.executeTemplate(
                            templateArgs.template_id, 
                            templateArgs.parameters || {},
                            fiscalContext
                        );
                        
                        var stepContent = '';
                        if (templateResult.success) {
                            // Record this template as successful to prevent duplicate calls
                            recordSuccessfulPurpose('template:' + templateArgs.template_id);
                            
                            stepContent = templateResult.rowCount + ' rows returned';
                            if (templateResult.columns && templateResult.columns.length > 0) {
                                stepContent += '\nColumns: ' + templateResult.columns.join(', ');
                            }
                            if (templateResult.substitutions && Object.keys(templateResult.substitutions).length > 0) {
                                var paramStrs = [];
                                for (var k in templateResult.substitutions) {
                                    if (templateResult.substitutions.hasOwnProperty(k) && !k.startsWith('fiscal.')) {
                                        paramStrs.push(k + '="' + templateResult.substitutions[k] + '"');
                                    }
                                }
                                if (paramStrs.length > 0) {
                                    stepContent += '\nParameters: ' + paramStrs.join(', ');
                                }
                            }
                            if (templateResult.rowCount > 0 && templateResult.rows) {
                                var sampleRows = templateResult.rows.slice(0, 3);
                                stepContent += '\nSample: ' + JSON.stringify(sampleRows).substring(0, 200);
                            }
                            if (templateResult.rowCount === 0 && templateResult.zeroRowGuidance) {
                                stepContent += '\n⚠️ ' + templateResult.zeroRowGuidance;
                            }
                        } else {
                            stepContent = 'Failed: ' + templateResult.error;
                        }
                        
                        steps.push({
                            type: 'tool',
                            title: 'Executing template: ' + templateArgs.template_id,
                            status: templateResult.success ? (templateResult.rowCount === 0 ? 'warning' : 'complete') : 'error',
                            content: stepContent,
                            timestamp: Date.now(),
                            toolName: 'execute_template',
                            toolArgs: {
                                template_id: templateArgs.template_id,
                                parameters: originalParams
                            },
                            sql: templateResult.executedSql,
                            substitutions: templateResult.substitutions,
                            columns: templateResult.columns,
                            rowCount: templateResult.rowCount || 0,
                            sampleData: templateResult.rows ? templateResult.rows.slice(0, 3) : []
                        });
                        
                        // Get template for format and title
                        var template = Templates.getTemplate(templateArgs.template_id);
                        
                        toolResults.push({
                            step: iteration + 1,
                            tool: 'execute_template',
                            template_id: templateArgs.template_id,
                            parameters: originalParams,
                            purpose: planStep ? planStep.purpose : 'Template: ' + templateArgs.template_id,
                            result: templateResult,
                            // Store template's resultFormat for rich rendering
                            templateFormat: template ? template.resultFormat : null
                        });
                        
                        // Check if we can auto-return without synthesis
                        if (templateResult.success) {
                            // Build descriptive title from template
                            var templateTitle = '';
                            if (template && template.name) {
                                templateTitle = template.name;
                            } else if (templateArgs.template_id) {
                                templateTitle = templateArgs.template_id.replace(/_/g, ' ').replace(/\b\w/g, function(c) { return c.toUpperCase(); });
                            } else {
                                templateTitle = 'Results';
                            }
                            
                            var autoResponse = tryAutoReturn(plan, toolResults, resolvedEntities, fiscalContext, steps, startTime, result, templateTitle);
                            if (autoResponse) {
                                autoResponse.sessionContext = updatedSessionContext;
                                return autoResponse;
                            }
                        }
                        
                        continue;
                    }
                    
                    if (toolCall.name === 'resolve_entity') {
                        var entitiesToResolve = [];
                        
                        if (toolCall.arguments.entities && Array.isArray(toolCall.arguments.entities)) {
                            entitiesToResolve = toolCall.arguments.entities;
                        } else if (toolCall.arguments.term && toolCall.arguments.entity_type) {
                            entitiesToResolve = [{ 
                                term: toolCall.arguments.term, 
                                entity_type: toolCall.arguments.entity_type 
                            }];
                        }
                        
                        // Filter out any entities with missing term
                        entitiesToResolve = entitiesToResolve.filter(function(e) {
                            return e && e.term && typeof e.term === 'string' && e.term.length > 0;
                        });
                        
                        if (entitiesToResolve.length === 0) {
                            log.debug('resolve_entity called with no valid entities');
                            continue;
                        }
                        
                        var results = [];
                        var anyNewResolutions = false;
                        
                        for (var ei = 0; ei < entitiesToResolve.length; ei++) {
                            var ent = entitiesToResolve[ei];
                            var termLower = (ent.term || '').toLowerCase();
                            
                            var inSessionContext = resolvedEntities[termLower] && resolvedEntities[termLower].id;
                            
                            var alreadyResolved = toolResults.some(function(tr) {
                                return tr.tool === 'resolve_entity' && 
                                    tr.term && tr.term.toLowerCase() === termLower &&
                                    tr.entityType === ent.entity_type;
                            });
                            
                            if (inSessionContext) {
                                results.push({
                                    term: ent.term,
                                    entityType: ent.entity_type,
                                    resolved: true,
                                    id: resolvedEntities[termLower].id,
                                    name: resolvedEntities[termLower].name,
                                    fromContext: true
                                });
                            } else if (alreadyResolved) {
                                var prevResult = toolResults.find(function(tr) {
                                    return tr.tool === 'resolve_entity' && 
                                        tr.term && tr.term.toLowerCase() === termLower;
                                });
                                var resultObj = {
                                    term: ent.term,
                                    entityType: ent.entity_type,
                                    duplicate: true
                                };
                                if (prevResult && prevResult.result) {
                                    Object.assign(resultObj, prevResult.result);
                                }
                                results.push(resultObj);
                            } else {
                                var resolution = EntityResolver.executeEntityResolution(ent);
                                var resObj = {
                                    term: ent.term,
                                    entityType: ent.entity_type
                                };
                                Object.assign(resObj, resolution);
                                results.push(resObj);
                                anyNewResolutions = true;
                                
                                toolResults.push({
                                    step: iteration + 1,
                                    tool: 'resolve_entity',
                                    term: ent.term,
                                    entityType: ent.entity_type,
                                    result: resolution
                                });
                                
                                if (resolution.resolved && resolution.id) {
                                    resolvedEntities[termLower] = {
                                        type: ent.entity_type,
                                        id: resolution.id,
                                        name: resolution.name || ent.term
                                    };
                                }
                            }
                        }
                        
                        if (anyNewResolutions) {
                            var newResults = results.filter(function(r) { return !r.fromContext && !r.duplicate; });
                            var resolvedCount = newResults.filter(function(r) { return r.resolved; }).length;
                            var terms = newResults.map(function(e) { return e.term; }).join(', ');
                            steps[steps.length - 1].title = 'Resolve entities: ' + terms;
                            steps[steps.length - 1].resolved = resolvedCount + '/' + newResults.length + ' resolved';
                            
                            var contentParts = newResults.map(function(r) {
                                if (r.resolved) {
                                    return '✓ "' + r.term + '" → ' + r.name + ' (ID: ' + r.id + ')';
                                } else if (r.notFound) {
                                    return '✗ "' + r.term + '" not found';
                                } else if (r.ambiguous) {
                                    return '? "' + r.term + '" ambiguous: ' + (r.options ? r.options.slice(0,3).map(function(o) { return o.name; }).join(', ') : '');
                                }
                                return '"' + r.term + '" - ' + (r.message || 'unknown');
                            });
                            steps[steps.length - 1].content = contentParts.join('\n');
                        } else {
                            steps.pop();
                        }
                        
                        continue;
                    }
                    
                    // GET_RECORD_SCHEMA TOOL - Dynamic schema discovery with deduplication
                    if (toolCall.name === 'get_record_schema') {
                        var schemaArgs = toolCall.arguments;
                        var recordType = (schemaArgs.record_type || '').toLowerCase();
                        
                        // ═══════════════════════════════════════════════════════════════
                        // DEDUPLICATION: Skip if already loaded OR already failed
                        // ═══════════════════════════════════════════════════════════════
                        
                        // Check if already successfully loaded
                        if (successfulSchemas[recordType]) {
                            log.debug('Schema request skipped - already loaded', { recordType: recordType });
                            toolResults.push({
                                step: iteration + 1,
                                tool: 'get_record_schema',
                                record_type: schemaArgs.record_type,
                                result: {
                                    success: true,
                                    message: 'Schema already loaded: ' + successfulSchemas[recordType],
                                    skipped: true
                                }
                            });
                            continue;
                        }
                        
                        // Check if already failed - block immediately after first failure
                        if (failedSchemaRequests[recordType]) {
                            var failCount = failedSchemaRequests[recordType];
                            log.debug('Schema request blocked - already failed', { 
                                recordType: recordType, 
                                failCount: failCount 
                            });
                            
                            // Provide helpful alternatives
                            var alternatives = [];
                            if (recordType === 'expense' || recordType === 'expenses') {
                                alternatives = ['vendorbill', 'expensereport'];
                            } else if (recordType === 'transactionaccountingline') {
                                alternatives = ['Use transactionaccountingline in SuiteQL queries directly'];
                            } else {
                                alternatives = ['vendorbill', 'invoice', 'salesorder', 'customer', 'vendor'];
                            }
                            
                            toolResults.push({
                                step: iteration + 1,
                                tool: 'get_record_schema',
                                record_type: schemaArgs.record_type,
                                result: {
                                    success: false,
                                    error: 'Schema for "' + recordType + '" is not available. ' +
                                           'This record type may not be scriptable. Try: ' + alternatives.join(', '),
                                    skipped: true,
                                    alternatives: alternatives
                                }
                            });
                            continue;
                        }
                        
                        var schemaResult = Utils.getRecordSchema(schemaArgs.record_type);
                        
                        toolResults.push({
                            step: iteration + 1,
                            tool: 'get_record_schema',
                            record_type: schemaArgs.record_type,
                            result: schemaResult
                        });
                        
                        if (schemaResult.success) {
                            // Format a useful summary for the AI
                            var fieldList = Object.keys(schemaResult.schema.fields).slice(0, 30);
                            var customFields = fieldList.filter(function(f) { 
                                return schemaResult.schema.fields[f].isCustom; 
                            });
                            
                            // Track successful schema load for deduplication
                            var schemaSummary = schemaResult.fieldCount + ' fields, ' + 
                                schemaResult.sublistCount + ' sublists' + 
                                (customFields.length > 0 ? ' (' + customFields.length + ' custom)' : '');
                            successfulSchemas[recordType] = schemaSummary;
                            
                            steps[steps.length - 1].title = 'Schema: ' + schemaArgs.record_type;
                            steps[steps.length - 1].content = schemaSummary;
                            steps[steps.length - 1].type = 'schema';
                            
                            log.debug('Schema Discovery Success', {
                                recordType: schemaArgs.record_type,
                                fieldCount: schemaResult.fieldCount,
                                customFields: customFields.length
                            });
                        } else {
                            // Track the failure for deduplication
                            failedSchemaRequests[recordType] = (failedSchemaRequests[recordType] || 0) + 1;
                            
                            steps[steps.length - 1].title = 'Schema: ' + schemaArgs.record_type + ' (failed)';
                            steps[steps.length - 1].content = schemaResult.error;
                            steps[steps.length - 1].type = 'error';
                            
                            // Add helpful hint about valid record types
                            if (recordType === 'transaction') {
                                schemaResult.hint = 'Note: "transaction" is a SuiteQL table, not a scriptable record. ' +
                                    'Use specific types like "vendorbill", "invoice", "salesorder", etc.';
                            }
                        }
                        
                        continue;
                    }
                    
                    // THINK TOOL
                    if (toolCall.name === 'think') {
                        var thought = toolCall.arguments;
                        
                        toolResults.push({
                            step: iteration + 1,
                            tool: 'think',
                            observations: thought.observations,
                            data_gaps: thought.data_gaps,
                            next_action: thought.next_action,
                            reasoning: thought.reasoning,
                            result: thought
                        });
                        
                        steps[steps.length - 1].title = 'Reasoning';
                        steps[steps.length - 1].content = thought.observations ? thought.observations.substring(0, 200) : 'Analyzing...';
                        steps[steps.length - 1].type = 'thinking';
                        
                        // SHORT CIRCUIT 1: Auto-execute suggested query
                        if (thought.next_action === 'query_more' && thought.suggested_query && autoQueryCount < MAX_AUTO_QUERIES) {
                            var govCheck = Utils.checkGovernance(GOVERNANCE_THRESHOLD_QUERY);
                            if (govCheck.hasEnough) {
                                log.debug('Think short-circuit: Auto-executing suggested query', {
                                    iteration: iteration,
                                    autoQueryCount: autoQueryCount
                                });
                                
                                var cleanedQuery = Utils.cleanQuery(thought.suggested_query);
                                var validation = QueryValidator.validateQuery(cleanedQuery);
                                
                                var queryResult;
                                if (validation.valid) {
                                    autoQueryCount++;
                                    queryResult = executeAgentQuery({ 
                                        query: cleanedQuery, 
                                        purpose: 'Auto-executed: ' + (thought.reasoning || 'from think tool')
                                    }, fiscalContext);
                                } else {
                                    queryResult = {
                                        success: false,
                                        error: 'Query validation failed: ' + validation.reason,
                                        suggestion: validation.suggestion
                                    };
                                }
                                
                                toolResults.push({
                                    step: iteration + 1,
                                    tool: 'query',
                                    purpose: 'Auto-query: ' + (thought.reasoning || 'Details'),
                                    query: cleanedQuery,
                                    result: queryResult,
                                    autoExecuted: true
                                });
                                
                                steps.push({
                                    type: 'tool',
                                    title: queryResult.success 
                                        ? 'Auto-query: ' + queryResult.rowCount + ' rows' 
                                        : 'Auto-query failed',
                                    status: queryResult.success ? 'complete' : 'warning',
                                    content: queryResult.success 
                                        ? 'Retrieved ' + queryResult.rowCount + ' rows' 
                                        : 'Error: ' + queryResult.error,
                                    timestamp: Date.now()
                                });
                                
                                continue;
                            } else {
                                log.debug('Skipping auto-query due to low governance');
                            }
                        }
                        
                        // SHORT CIRCUIT 2: Immediate finish with preliminary answer
                        if (thought.next_action === 'done' && thought.preliminary_answer) {
                            log.debug('Think short-circuit: Finalizing with preliminary answer');
                            
                            var keyFindings = [];
                            if (thought.observations) {
                                var bulletMatches = thought.observations.match(/[-•*]\s*([^\n]+)/g);
                                var numberedMatches = thought.observations.match(/\d+\.\s*([^\n]+)/g);
                                if (bulletMatches) {
                                    keyFindings = bulletMatches.map(function(b) { return b.replace(/^[-•*]\s*/, '').trim(); }).slice(0, 5);
                                } else if (numberedMatches) {
                                    keyFindings = numberedMatches.map(function(n) { return n.replace(/^\d+\.\s*/, '').trim(); }).slice(0, 5);
                                }
                            }
                            
                            var finalAnswerArgs = {
                                answer: thought.preliminary_answer,
                                key_findings: keyFindings,
                                reasoning: thought.reasoning
                            };
                            
                            var response = buildAgentResponse(finalAnswerArgs, toolResults, steps, startTime, result, message);
                            response.sessionContext = updatedSessionContext;
                            response.shortCircuited = true;
                            return response;
                        }
                        
                        if (thought.next_action === 'done') {
                            toolResults.push({
                                step: iteration + 1,
                                tool: 'system_hint',
                                message: 'Analysis complete. Call final_response with your synthesis.'
                            });
                        }
                        
                        continue;
                    }
                    
                    // INSPECT_RESULT TOOL
                    if (toolCall.name === 'inspect_result') {
                        var args = toolCall.arguments;
                        var targetResult = toolResults.find(function(r) { return r.step === args.result_step && (r.tool === 'query' || r.tool === 'execute_template'); });
                        
                        if (!targetResult) {
                            var dataSteps = toolResults
                                .filter(function(r) { return r.tool === 'query' || r.tool === 'execute_template'; })
                                .map(function(r) { return r.step; });
                            var availableMsg = dataSteps.length > 0 
                                ? 'Available: steps ' + dataSteps.join(', ') 
                                : 'No query results yet';
                            toolResults.push({
                                step: iteration + 1,
                                tool: 'inspect_result',
                                error: 'Step ' + args.result_step + ' not found. ' + availableMsg
                            });
                            steps[steps.length - 1].title = 'Inspect failed';
                            steps[steps.length - 1].content = 'Step ' + args.result_step + ' doesn\'t exist. ' + availableMsg;
                            steps[steps.length - 1].status = 'error';
                            continue;
                        }
                        
                        if (!targetResult.result || !targetResult.result.success) {
                            toolResults.push({
                                step: iteration + 1,
                                tool: 'inspect_result',
                                error: 'Step ' + args.result_step + ' query failed: ' + (targetResult.result ? targetResult.result.error : 'unknown')
                            });
                            steps[steps.length - 1].title = 'Inspect failed';
                            steps[steps.length - 1].content = 'Step ' + args.result_step + ' has no successful data';
                            steps[steps.length - 1].status = 'error';
                            continue;
                        }
                        
                        var inspectionResult;
                        var data = targetResult.result;
                        
                        switch (args.action) {
                            case 'more_rows':
                                // Check if more_rows is actually useful
                                var queryLimit = targetResult.queryLimit;
                                var rowCount = data.rowCount;
                                
                                // If query had a limit and returned exactly that many or fewer, more_rows is useless
                                if (queryLimit && rowCount <= queryLimit) {
                                    inspectionResult = {
                                        success: true,
                                        message: 'You already have ALL the data from this query. The query had a LIMIT of ' + queryLimit + ' and returned ' + rowCount + ' rows. There are no additional rows to retrieve.',
                                        rows: data.rows,
                                        rowCount: rowCount,
                                        columns: data.columns,
                                        noMoreData: true
                                    };
                                    steps[steps.length - 1].title = 'All data already visible (' + rowCount + ' rows)';
                                    
                                    // Add warning to tool results so LLM knows not to do this again
                                    toolResults.push({
                                        step: iteration + 1,
                                        tool: 'inspect_result',
                                        action: 'more_rows',
                                        sourceStep: args.result_step,
                                        result: inspectionResult,
                                        warning: 'more_rows was unnecessary - data was not truncated'
                                    });
                                    steps[steps.length - 1].content = 'Query returned all ' + rowCount + ' rows (LIMIT was ' + queryLimit + ')';
                                    steps[steps.length - 1].status = 'complete';
                                    continue;
                                }
                                
                                inspectionResult = {
                                    success: true,
                                    rows: data.rows.slice(0, 50),
                                    rowCount: data.rowCount,
                                    columns: data.columns,
                                    showing: Math.min(50, data.rowCount)
                                };
                                steps[steps.length - 1].title = 'Viewing more rows (' + inspectionResult.showing + ' of ' + data.rowCount + ')';
                                break;
                                
                            case 'specific_columns':
                                var cols = args.columns || data.columns;
                                inspectionResult = {
                                    success: true,
                                    rows: data.rows.map(function(row) {
                                        var filtered = {};
                                        cols.forEach(function(c) {
                                            var key = Object.keys(row).find(function(k) { return k.toLowerCase() === c.toLowerCase(); });
                                            if (key) filtered[c] = row[key];
                                        });
                                        return filtered;
                                    }),
                                    columns: cols,
                                    rowCount: data.rowCount
                                };
                                steps[steps.length - 1].title = 'Selected columns: ' + cols.join(', ');
                                break;
                                
                            case 'filter':
                                var filtered = data.rows.filter(function(row) {
                                    var key = Object.keys(row).find(function(k) { return k.toLowerCase() === (args.filter_column || '').toLowerCase(); });
                                    return key && String(row[key]).toLowerCase().includes((args.filter_value || '').toLowerCase());
                                });
                                inspectionResult = {
                                    success: true,
                                    rows: filtered,
                                    rowCount: filtered.length,
                                    columns: data.columns,
                                    filterApplied: args.filter_column + ' contains "' + args.filter_value + '"'
                                };
                                steps[steps.length - 1].title = 'Filtered: ' + filtered.length + ' matching rows';
                                break;
                                
                            case 'aggregate':
                                var grouped = {};
                                data.rows.forEach(function(row) {
                                    var groupKey = args.group_by 
                                        ? row[Object.keys(row).find(function(k) { return k.toLowerCase() === (args.group_by || '').toLowerCase(); })] || 'unknown'
                                        : 'total';
                                    if (!grouped[groupKey]) grouped[groupKey] = [];
                                    var valKey = Object.keys(row).find(function(k) { return k.toLowerCase() === (args.aggregate_column || '').toLowerCase(); });
                                    if (valKey) grouped[groupKey].push(parseFloat(row[valKey]) || 0);
                                });
                                
                                var aggregated = Object.entries(grouped).map(function(entry) {
                                    var key = entry[0];
                                    var values = entry[1];
                                    var result;
                                    switch (args.aggregate_function) {
                                        case 'sum': result = values.reduce(function(a, b) { return a + b; }, 0); break;
                                        case 'avg': result = values.length > 0 ? values.reduce(function(a, b) { return a + b; }, 0) / values.length : null; break;
                                        case 'min': result = values.length > 0 ? Math.min.apply(null, values) : null; break;
                                        case 'max': result = values.length > 0 ? Math.max.apply(null, values) : null; break;
                                        case 'count': default: result = values.length; break;
                                    }
                                    var obj = {};
                                    obj[args.group_by || 'group'] = key;
                                    obj[args.aggregate_function || 'value'] = result;
                                    return obj;
                                });
                                
                                inspectionResult = {
                                    success: true,
                                    rows: aggregated,
                                    rowCount: aggregated.length,
                                    columns: [args.group_by || 'group', args.aggregate_function || 'value'],
                                    aggregation: args.aggregate_function + '(' + args.aggregate_column + ')' + (args.group_by ? ' by ' + args.group_by : '')
                                };
                                steps[steps.length - 1].title = 'Aggregated: ' + args.aggregate_function + '(' + args.aggregate_column + ')';
                                break;
                                
                            default:
                                inspectionResult = { success: false, error: 'Unknown action' };
                        }
                        
                        toolResults.push({
                            step: iteration + 1,
                            tool: 'inspect_result',
                            action: args.action,
                            sourceStep: args.result_step,
                            result: inspectionResult
                        });
                        
                        steps[steps.length - 1].content = inspectionResult.success 
                            ? inspectionResult.rowCount + ' rows' 
                            : inspectionResult.error;
                        continue;
                    }
                    
                    // REFLECT_AND_ADAPT TOOL - Powerful adaptive planning
                    if (toolCall.name === 'reflect_and_adapt') {
                        var reflection = toolCall.arguments;
                        
                        addAgentDebug('Reflection received', {
                            assessment: reflection.plan_assessment,
                            confidence: reflection.confidence,
                            nextAction: reflection.next_immediate_action,
                            modifications: reflection.plan_modifications ? reflection.plan_modifications.length : 0
                        });
                        
                        // Store the reflection
                        toolResults.push({
                            step: iteration + 1,
                            tool: 'reflect',
                            analysis: reflection.analysis,
                            key_findings: reflection.key_findings,
                            plan_assessment: reflection.plan_assessment,
                            plan_modifications: reflection.plan_modifications,
                            next_action: reflection.next_immediate_action,
                            confidence: reflection.confidence,
                            result: reflection
                        });
                        
                        steps[steps.length - 1].type = 'reflection';
                        steps[steps.length - 1].title = 'Reflecting on findings';
                        steps[steps.length - 1].content = reflection.analysis ? reflection.analysis.substring(0, 200) : 'Analyzing data...';
                        steps[steps.length - 1].reflection = {
                            assessment: reflection.plan_assessment,
                            confidence: reflection.confidence,
                            keyFindings: reflection.key_findings
                        };
                        
                        // Apply plan modifications if any
                        if (reflection.plan_modifications && reflection.plan_modifications.length > 0) {
                            reflection.plan_modifications.forEach(function(mod) {
                                if (mod.action === 'add_query' && mod.new_query) {
                                    // Add new step to plan
                                    if (!plan.added_steps) plan.added_steps = [];
                                    plan.added_steps.push({
                                        action: 'query',
                                        purpose: mod.new_query.purpose,
                                        sql: mod.new_query.sql,
                                        from_reflection: true
                                    });
                                    
                                    addAgentDebug('Plan modified: added query', {
                                        purpose: mod.new_query.purpose,
                                        reason: mod.reason
                                    });
                                } else if (mod.action === 'skip_step' && mod.step_number) {
                                    // Mark step as skipped
                                    if (!plan.skipped_steps) plan.skipped_steps = [];
                                    plan.skipped_steps.push(mod.step_number);
                                    
                                    addAgentDebug('Plan modified: skipped step', {
                                        stepNumber: mod.step_number,
                                        reason: mod.reason
                                    });
                                } else if (mod.action === 'change_synthesis' && mod.new_synthesis) {
                                    // Update synthesis instructions
                                    plan.synthesis_instructions = mod.new_synthesis;
                                    plan.requires_synthesis = true;
                                    
                                    addAgentDebug('Plan modified: changed synthesis', {
                                        reason: mod.reason
                                    });
                                }
                            });
                            
                            steps.push({
                                type: 'plan_adaptation',
                                title: 'Plan adapted',
                                status: 'complete',
                                content: reflection.plan_modifications.length + ' modification(s) applied',
                                timestamp: Date.now(),
                                modifications: reflection.plan_modifications
                            });
                        }
                        
                        // Handle immediate action
                        if (reflection.next_immediate_action === 'execute_new_query' && reflection.immediate_query) {
                            // Execute the new query immediately
                            var govCheck = Utils.checkGovernance(GOVERNANCE_THRESHOLD_QUERY);
                            if (govCheck.hasEnough) {
                                var newQuery = reflection.immediate_query;
                                var cleanedQuery = Utils.cleanQuery(newQuery.sql);
                                var validation = QueryValidator.validateQuery(cleanedQuery);
                                
                                var queryResult;
                                if (validation.valid) {
                                    queryResult = executeAgentQuery({ 
                                        query: cleanedQuery, 
                                        purpose: newQuery.purpose || 'Reflection-driven query'
                                    }, fiscalContext);
                                } else {
                                    queryResult = {
                                        success: false,
                                        error: 'Query validation failed: ' + validation.reason
                                    };
                                }
                                
                                toolResults.push({
                                    step: iteration + 1,
                                    tool: 'query',
                                    purpose: newQuery.purpose || 'Reflection query',
                                    query: cleanedQuery,
                                    result: queryResult,
                                    fromReflection: true
                                });
                                
                                steps.push({
                                    type: 'agent_step',
                                    title: newQuery.purpose || 'Reflection query',
                                    status: queryResult.success ? 'complete' : 'error',
                                    content: queryResult.success 
                                        ? 'Found ' + queryResult.rowCount + ' results'
                                        : 'Failed: ' + queryResult.error,
                                    timestamp: Date.now(),
                                    sql: cleanedQuery,
                                    rowCount: queryResult.rowCount,
                                    columns: queryResult.columns,
                                    sampleData: queryResult.rows ? queryResult.rows.slice(0, 3) : [],
                                    toolName: 'execute_query',
                                    fromReflection: true
                                });
                            }
                        } else if (reflection.next_immediate_action === 'skip_to_synthesis') {
                            // Force synthesis on next iteration
                            toolResults.push({
                                step: iteration + 1,
                                tool: 'system_hint',
                                message: 'Reflection indicates sufficient data gathered. Proceed to final_response.'
                            });
                        } else if (reflection.next_immediate_action === 'ask_user' && reflection.user_question) {
                            // Return with a question for the user - use blocks format
                            var askResponse = ResponseBuilder.buildResponse(
                                '',
                                steps,
                                startTime,
                                { model: result.model, provider: result.provider }
                            );
                            askResponse.richContent = [{ type: 'text', content: reflection.user_question }];
                            askResponse.blocksFormat = true;
                            askResponse.sessionContext = updatedSessionContext;
                            askResponse.needsUserInput = true;
                            askResponse.reflection = reflection;
                            
                            if (Utils.isDebugMode()) {
                                askResponse._agentDebugLog = getAndClearAgentDebugLog();
                            }
                            
                            return askResponse;
                        }
                        
                        continue;
                    }
                    
                    // DEEP_THINK TOOL - Extended reasoning with working memory
                    if (toolCall.name === 'deep_think') {
                        var deepThinkArgs = toolCall.arguments;
                        
                        addAgentDebug('Deep think received', {
                            type: deepThinkArgs.thinking_type,
                            stepsCount: deepThinkArgs.reasoning_steps ? deepThinkArgs.reasoning_steps.length : 0,
                            nextAction: deepThinkArgs.next_action
                        });
                        
                        // Process deep thinking and update working memory
                        var thinkResult = AdaptiveIntelligence.processDeepThink(workingMemory, deepThinkArgs);
                        
                        // Store the deep think result
                        toolResults.push({
                            step: iteration + 1,
                            tool: 'deep_think',
                            thinking_type: deepThinkArgs.thinking_type,
                            reasoning_steps: deepThinkArgs.reasoning_steps,
                            updates: thinkResult.workingMemoryUpdates,
                            planChanges: thinkResult.planChanges,
                            nextAction: deepThinkArgs.next_action,
                            result: thinkResult
                        });
                        
                        steps[steps.length - 1].type = 'deep_thinking';
                        steps[steps.length - 1].title = 'Deep Thinking: ' + deepThinkArgs.thinking_type;
                        steps[steps.length - 1].content = deepThinkArgs.reasoning_steps ? 
                            deepThinkArgs.reasoning_steps.slice(0, 3).join(' → ') : 
                            'Extended analysis...';
                        steps[steps.length - 1].deepThink = {
                            type: deepThinkArgs.thinking_type,
                            steps: deepThinkArgs.reasoning_steps,
                            hypotheses: deepThinkArgs.hypotheses,
                            findings: deepThinkArgs.findings,
                            confidence: deepThinkArgs.confidence_assessment
                        };
                        
                        // Apply plan changes if any
                        if (thinkResult.planChanges) {
                            steps.push({
                                type: 'plan_adaptation',
                                title: 'Plan adapted from deep thinking',
                                status: 'complete',
                                content: thinkResult.planChanges.reason || 'Plan modified based on analysis',
                                timestamp: Date.now()
                            });
                        }
                        
                        // Handle immediate action
                        if (thinkResult.immediateAction) {
                            if (thinkResult.immediateAction.type === 'query' && thinkResult.immediateAction.sql) {
                                // Execute the query immediately
                                var govCheck = Utils.checkGovernance(GOVERNANCE_THRESHOLD_QUERY);
                                if (govCheck.hasEnough) {
                                    var cleanedQuery = Utils.cleanQuery(thinkResult.immediateAction.sql);
                                    var validation = QueryValidator.validateQuery(cleanedQuery);
                                    
                                    var queryResult;
                                    if (validation.valid) {
                                        queryResult = executeAgentQuery({ 
                                            query: cleanedQuery, 
                                            purpose: thinkResult.immediateAction.purpose || 'Deep think query'
                                        }, fiscalContext);
                                    } else {
                                        queryResult = {
                                            success: false,
                                            error: 'Query validation failed: ' + validation.reason
                                        };
                                    }
                                    
                                    toolResults.push({
                                        step: iteration + 1,
                                        tool: 'query',
                                        purpose: thinkResult.immediateAction.purpose || 'Deep think query',
                                        query: cleanedQuery,
                                        result: queryResult,
                                        fromDeepThink: true
                                    });
                                    
                                    steps.push({
                                        type: 'agent_step',
                                        title: thinkResult.immediateAction.purpose || 'Deep think query',
                                        status: queryResult.success ? 'complete' : 'error',
                                        content: queryResult.success 
                                            ? 'Found ' + queryResult.rowCount + ' results'
                                            : 'Failed: ' + queryResult.error,
                                        timestamp: Date.now(),
                                        sql: cleanedQuery,
                                        rowCount: queryResult.rowCount,
                                        columns: queryResult.columns,
                                        sampleData: queryResult.rows ? queryResult.rows.slice(0, 3) : [],
                                        toolName: 'execute_query',
                                        fromDeepThink: true
                                    });
                                }
                            } else if (thinkResult.immediateAction.type === 'finalize' && thinkResult.immediateAction.conclusion) {
                                // Finalize immediately with the conclusion
                                var finalArgs = {
                                    blocks: [{
                                        type: 'text',
                                        content: thinkResult.immediateAction.conclusion
                                    }]
                                };
                                
                                var response = buildAgentResponse(finalArgs, toolResults, steps, startTime, result, message);
                                response.sessionContext = updatedSessionContext;
                                response.fromDeepThink = true;
                                response.workingMemory = {
                                    findings: workingMemory.findings,
                                    hypotheses: workingMemory.hypotheses,
                                    confidence: workingMemory.overallConfidence
                                };
                                
                                if (Utils.isDebugMode()) {
                                    response._agentDebugLog = getAndClearAgentDebugLog();
                                }
                                
                                return response;
                            }
                        }
                        
                        continue;
                    }
                    } // End of for loop processing queryToolCalls
                    
                    // After processing all query tool calls, handle pendingFinalResponse if present
                    if (pendingFinalResponse) {
                        addAgentDebug('Processing pendingFinalResponse after queries', {
                            queriesProcessed: queryToolCalls.length
                        });
                        
                        steps[steps.length - 1].title = 'Synthesizing answer';
                        var response = buildAgentResponse(pendingFinalResponse.arguments, toolResults, steps, startTime, result, message);
                        var lastQueryResult = toolResults.filter(function(r) { return r.tool === 'query'; }).pop();
                        if (lastQueryResult && lastQueryResult.result) {
                            updatedSessionContext = Planning.updateSessionContext(updatedSessionContext, {
                                queryResult: lastQueryResult.result,
                                query: lastQueryResult.query,
                                topics: QueryExecution.extractTopicsFromQuery(message, lastQueryResult.purpose)
                            });
                        }
                        response.sessionContext = updatedSessionContext;
                        return response;
                    }
                }
                
                if (result.text && (!result.toolCalls || result.toolCalls.length === 0)) {
                    addAgentDebug('Text response received', {
                        textLength: result.text.length,
                        textPreview: result.text.substring(0, 200)
                    });
                    
                    var currentTools = ToolDefinitions.getAgentToolsForPlan(plan);
                    var toolComplianceCheck = ToolDefinitions.checkToolCompliance(result.text, currentTools);
                    
                    if (toolComplianceCheck.failed) {
                        log.debug('Tool compliance failure detected', { 
                            model: result.model, 
                            failureType: toolComplianceCheck.type,
                            iteration: iteration 
                        });
                        
                        var retryKey = 'tool_retry_' + iteration;
                        var currentRetries = toolResults.filter(function(tr) { return tr.retryKey === retryKey; }).length;
                        
                        if (currentRetries === 0) {
                            steps[steps.length - 1].status = 'warning';
                            steps[steps.length - 1].title = 'Tool use error - retrying';
                            steps[steps.length - 1].content = 'Model output JSON as text instead of using tools. Retrying...';
                            
                            toolResults.push({ retryKey: retryKey, attempt: 1 });
                            
                            var retryPrompt = agentPrompt + '\n\nCRITICAL REMINDER: You MUST use tool calls. Do NOT output JSON in your response text. Call the final_response tool or execute_query tool directly.';
                            
                            try {
                                var retryResult = AIProviders.callAI(retryPrompt, {
                                    systemPrompt: agentSystemPrompt,
                                    chatHistory: history,
                                    tools: currentTools,
                                    maxTokens: DEFAULT_MAX_TOKENS,
                                    temperature: 0.1,
                                    purpose: 'Agent step ' + (iteration + 1) + ' (retry)',
                                    tier: 2
                                });
                                
                                if (retryResult.type === 'tool_call' && retryResult.toolCalls && retryResult.toolCalls.length > 0) {
                                    steps[steps.length - 1].status = 'complete';
                                    steps[steps.length - 1].title = 'Analysis step ' + (iteration + 1);
                                    steps[steps.length - 1].content = 'Retry successful';
                                    
                                    result = retryResult;
                                    var toolCall = retryResult.toolCalls[0];
                                    if (toolCall.name === 'final_answer' || toolCall.name === 'final_response') {
                                        steps[steps.length - 1].title = 'Synthesizing answer';
                                        var response = buildAgentResponse(toolCall.arguments, toolResults, steps, startTime, retryResult, message);
                                        response.sessionContext = updatedSessionContext;
                                        return response;
                                    }
                                    continue;
                                }
                            } catch (retryError) {
                                log.debug('Retry failed', { error: retryError.message });
                            }
                        }
                        
                        if (currentRetries <= 1) {
                            steps[steps.length - 1].status = 'warning';
                            steps[steps.length - 1].title = 'Escalating to better model';
                            steps[steps.length - 1].content = 'Model failed tool use twice. Escalating to tier 3...';
                            
                            toolResults.push({ retryKey: retryKey, attempt: 2 });
                            
                            try {
                                var escalateResult = AIProviders.callAI(agentPrompt + '\n\nYou MUST respond with a tool call. Use final_response tool to provide your response.', {
                                    systemPrompt: agentSystemPrompt,
                                    chatHistory: history,
                                    tools: currentTools,
                                    maxTokens: DEFAULT_MAX_TOKENS,
                                    temperature: 0.1,
                                    purpose: 'Agent step ' + (iteration + 1) + ' (escalated)',
                                    tier: 3
                                });
                                
                                if (escalateResult.type === 'tool_call' && escalateResult.toolCalls && escalateResult.toolCalls.length > 0) {
                                    steps[steps.length - 1].status = 'complete';
                                    steps[steps.length - 1].title = 'Analysis step ' + (iteration + 1);
                                    steps[steps.length - 1].content = 'Escalation successful';
                                    
                                    var toolCall = escalateResult.toolCalls[0];
                                    if (toolCall.name === 'final_answer' || toolCall.name === 'final_response') {
                                        steps[steps.length - 1].title = 'Synthesizing answer';
                                        var response = buildAgentResponse(toolCall.arguments, toolResults, steps, startTime, escalateResult, message);
                                        response.sessionContext = updatedSessionContext;
                                        return response;
                                    }
                                    continue;
                                }
                            } catch (escalateError) {
                                log.debug('Escalation failed', { error: escalateError.message });
                            }
                        }
                        
                        steps[steps.length - 1].status = 'warning';
                        steps[steps.length - 1].content = 'Tool use failed after retries';
                    }
                    
                    var cleanText = result.text;
                    cleanText = cleanText.replace(/```sql[\s\S]*?```/gi, '');
                    cleanText = cleanText.replace(/`sql[\s\S]*?`/gi, '');
                    
                    if (cleanText.trim().match(/^SELECT\s/i) || result.text.includes('SELECT') && result.text.includes('FROM')) {
                        log.debug('Agent returned SQL in text, attempting to parse');
                        var sqlMatch = result.text.match(/SELECT[\s\S]+?(?:FETCH\s+FIRST\s+\d+\s+ROWS\s+ONLY|;|\n\n|$)/i);
                        if (sqlMatch) {
                            var extractedQuery = sqlMatch[0].replace(/```/g, '').trim();
                            var queryResult = executeAgentQuery({ query: extractedQuery, purpose: 'Extracted query' }, fiscalContext);
                            toolResults.push({
                                step: iteration + 1,
                                tool: 'query',
                                purpose: 'Auto-extracted query',
                                query: extractedQuery,
                                result: queryResult
                            });
                            
                            steps[steps.length - 1].title = 'Execute query';
                            steps[steps.length - 1].content = queryResult.success 
                                ? 'Found ' + queryResult.rowCount + ' result' + (queryResult.rowCount !== 1 ? 's' : '')
                                : 'Query failed: ' + queryResult.error;
                            steps[steps.length - 1].sql = extractedQuery;
                            steps[steps.length - 1].rowCount = queryResult.rowCount;
                            
                            continue;
                        }
                    }
                    
                    // Scan text for template ID mentions and auto-execute
                    var templateScanResult = scanTextForTemplateAndExecute(result.text, fiscalContext, resolvedEntities);
                    if (templateScanResult && templateScanResult.success) {
                        toolResults.push({
                            step: iteration + 1,
                            tool: 'execute_template',
                            purpose: 'Auto-detected template: ' + templateScanResult.template_id,
                            template_id: templateScanResult.template_id,
                            result: templateScanResult
                        });
                        
                        steps[steps.length - 1].title = 'Execute template: ' + templateScanResult.template_id;
                        steps[steps.length - 1].content = 'Found ' + templateScanResult.rowCount + ' result' + (templateScanResult.rowCount !== 1 ? 's' : '');
                        steps[steps.length - 1].rowCount = templateScanResult.rowCount;
                        steps[steps.length - 1]._autoDetected = true;
                        
                        addAgentDebug('Auto-executed template from text scan', {
                            templateId: templateScanResult.template_id,
                            rowCount: templateScanResult.rowCount
                        });
                        
                        continue;
                    }
                    
                    cleanText = cleanText.trim();
                    
                    // Check if cleanText looks like final_response JSON (blocks format)
                    // Use robust JSON extraction to handle markdown fences, whitespace, etc.
                    var parsedBlocks = Utils.extractJsonFromText(cleanText, 'blocks');
                    if (parsedBlocks && parsedBlocks.blocks && Array.isArray(parsedBlocks.blocks)) {
                        log.debug('Parsed JSON text as final_response blocks');
                        steps[steps.length - 1].content = 'Generated response';
                        var blocksResponse = buildAgentResponse(parsedBlocks, toolResults, steps, startTime, result, message);
                        return finalizeResponse(blocksResponse, updatedSessionContext);
                    }
                    
                    if (cleanText.length > 50) {
                        // Check if plan steps are complete before returning
                        var dataGatheringActions = ['query', 'template'];
                        var completedDataSteps = toolResults.filter(function(tr) {
                            return (tr.tool === 'query' || tr.tool === 'execute_template') && tr.result && tr.result.success;
                        }).length;
                        var totalDataSteps = plan.plan ? plan.plan.filter(function(s) { 
                            return dataGatheringActions.indexOf(s.action) >= 0;
                        }).length : 0;
                        
                        // If plan steps are incomplete, don't return text - force continuation
                        if (completedDataSteps < totalDataSteps && iteration < MAX_ITERATIONS - 2) {
                            consecutiveTextResponses++;
                            
                            addAgentDebug('Text response with incomplete plan - forcing continuation', {
                                completedDataSteps: completedDataSteps,
                                totalDataSteps: totalDataSteps,
                                consecutiveTextResponses: consecutiveTextResponses,
                                currentTier: currentTier,
                                textPreview: cleanText.substring(0, 100)
                            });
                            
                            // Update step with more detail about what happened
                            steps[steps.length - 1].type = 'text_response_warning';
                            steps[steps.length - 1].title = 'LLM returned text (no tool calls)';
                            steps[steps.length - 1].status = 'warning';
                            steps[steps.length - 1].content = 'Model returned text instead of calling execute_query. ' +
                                'Completed ' + completedDataSteps + ' of ' + totalDataSteps + ' data queries. ' +
                                'Retry #' + consecutiveTextResponses;
                            steps[steps.length - 1].llmResponse = cleanText.substring(0, 500);
                            steps[steps.length - 1].completedQueries = completedDataSteps;
                            steps[steps.length - 1].totalQueries = totalDataSteps;
                            steps[steps.length - 1].consecutiveFailures = consecutiveTextResponses;
                            
                            // Escalate to tier 3 if model keeps failing to use tools
                            if (consecutiveTextResponses >= TEXT_RESPONSE_ESCALATION_THRESHOLD && currentTier < 3) {
                                currentTier = 3;
                                log.audit('Escalating to tier 3 due to consecutive text responses', {
                                    consecutiveTextResponses: consecutiveTextResponses,
                                    completedDataSteps: completedDataSteps,
                                    totalDataSteps: totalDataSteps
                                });
                                steps[steps.length - 1].content = 'Model not using tools. Escalating to premium model...';
                            } else {
                                steps[steps.length - 1].content = 'Model returned text instead of executing remaining queries. Retrying...';
                            }
                            
                            steps[steps.length - 1].status = 'warning';
                            
                            // Add incomplete steps to prompt for next iteration
                            var remainingSteps = plan.plan.filter(function(s, idx) {
                                return dataGatheringActions.indexOf(s.action) >= 0 && idx >= completedDataSteps;
                            });
                            if (remainingSteps.length > 0) {
                                var reminderText = '\n\n🚨 CRITICAL: YOU MUST USE TOOLS - DO NOT RETURN TEXT 🚨\n';
                                reminderText += 'You have ' + remainingSteps.length + ' queries remaining:\n';
                                remainingSteps.forEach(function(s, i) {
                                    reminderText += (i + 1) + '. ' + s.purpose + '\n';
                                });
                                reminderText += '\n⚠️ YOUR NEXT ACTION MUST BE: Call execute_query tool\n';
                                reminderText += 'DO NOT respond with text. DO NOT explain. ONLY call execute_query.\n';
                                reminderText += '\nIf you cannot determine the exact SQL, use the templates or make your best attempt.\n';
                                
                                // Store for next iteration
                                toolResults.push({
                                    step: iteration + 1,
                                    tool: '_incomplete_plan_warning',
                                    warning: reminderText
                                });
                            }
                            
                            // If we've had 4+ consecutive text responses, try to execute the query directly
                            if (consecutiveTextResponses >= 4 && remainingSteps.length > 0) {
                                addAgentDebug('Attempting direct query execution fallback', {
                                    consecutiveTextResponses: consecutiveTextResponses,
                                    nextStep: remainingSteps[0].purpose
                                });
                                
                                // Try to build a simple query based on the step purpose
                                var directQueryResult = attemptDirectQueryExecution(
                                    remainingSteps[0], 
                                    fiscalContext, 
                                    message, 
                                    toolResults
                                );
                                
                                if (directQueryResult && directQueryResult.success) {
                                    toolResults.push({
                                        step: iteration + 1,
                                        tool: 'query',
                                        purpose: remainingSteps[0].purpose,
                                        result: directQueryResult,
                                        sql: directQueryResult.sql,
                                        _directExecution: true
                                    });
                                    
                                    steps.push({
                                        type: 'agent_step',
                                        title: remainingSteps[0].purpose + ' (direct execution)',
                                        status: 'complete',
                                        timestamp: Date.now(),
                                        content: 'Found ' + directQueryResult.rowCount + ' results',
                                        sql: directQueryResult.sql,
                                        rowCount: directQueryResult.rowCount
                                    });
                                    
                                    consecutiveTextResponses = 0; // Reset since we made progress
                                    addAgentDebug('Direct query execution succeeded', {
                                        rowCount: directQueryResult.rowCount
                                    });
                                }
                            }
                            
                            continue; // Force continuation instead of returning
                        }
                        
                        // All data steps complete - return response immediately
                        // Reset counter if we're about to return (plan complete or exhausted iterations)
                        consecutiveTextResponses = 0;
                        
                        steps[steps.length - 1].title = 'Preparing response';
                        steps[steps.length - 1].content = 'All queries complete - formatting results';
                        
                        // Build blocks-format response with text and rich content interspersed
                        var richContentBlocks = [];
                        
                        // Add text as first block (even if short - it's the LLM's synthesis)
                        if (cleanText && cleanText.trim()) {
                            richContentBlocks.push({ type: 'text', content: cleanText });
                        }
                        
                        // Add richContent from successful queries/templates
                        toolResults.forEach(function(tr) {
                            if (tr.tool === 'query' || tr.tool === 'execute_template') {
                                var item = buildRichContentItem(tr);
                                if (item) {
                                    richContentBlocks.push(item);
                                }
                            }
                        });
                        
                        var textResponse = ResponseBuilder.buildResponse('', steps, startTime, { model: result.model, provider: result.provider });
                        textResponse.richContent = richContentBlocks;
                        textResponse.blocksFormat = true;
                        
                        return finalizeResponse(textResponse, updatedSessionContext);
                    }
                    
                    // Text is too short and we haven't completed all data steps
                    // Update step with context for the user
                    var dataGatheringActions2 = ['query', 'template'];
                    var completedSteps2 = toolResults.filter(function(tr) {
                        return (tr.tool === 'query' || tr.tool === 'execute_template') && tr.result && tr.result.success;
                    }).length;
                    var totalSteps2 = plan.plan ? plan.plan.filter(function(s) { 
                        return dataGatheringActions2.indexOf(s.action) >= 0;
                    }).length : 0;
                    
                    if (completedSteps2 >= totalSteps2 && toolResults.length > 0) {
                        // All data gathered, just need synthesis - return now
                        steps[steps.length - 1].title = 'Finalizing results';
                        steps[steps.length - 1].content = 'Building response from ' + toolResults.length + ' query results';
                        
                        var finalBlocks = [];
                        if (cleanText && cleanText.trim()) {
                            finalBlocks.push({ type: 'text', content: cleanText });
                        } else {
                            // Generate a summary
                            var summaryParts = [];
                            toolResults.forEach(function(tr) {
                                if (tr.result && tr.result.success) {
                                    summaryParts.push('• ' + (tr.purpose || 'Query') + ': ' + tr.result.rowCount + ' result' + (tr.result.rowCount !== 1 ? 's' : ''));
                                }
                            });
                            if (summaryParts.length > 0) {
                                finalBlocks.push({ type: 'text', content: 'Here\'s what I found:\n\n' + summaryParts.join('\n') + '\n' });
                            }
                        }
                        
                        toolResults.forEach(function(tr) {
                            if (tr.tool === 'query' || tr.tool === 'execute_template') {
                                var item = buildRichContentItem(tr);
                                if (item) finalBlocks.push(item);
                            }
                        });
                        
                        var finalResponse = ResponseBuilder.buildResponse('', steps, startTime, { model: result.model, provider: result.provider });
                        finalResponse.richContent = finalBlocks;
                        finalResponse.blocksFormat = true;
                        return finalizeResponse(finalResponse, updatedSessionContext);
                    }
                    
                    steps[steps.length - 1].title = 'Waiting for data...';
                    steps[steps.length - 1].content = 'Completed ' + completedSteps2 + ' of ' + totalSteps2 + ' queries';
                }
                
            } catch (e) {
                var errorStack = (e.stack && typeof e.stack === 'string') ? e.stack.substring(0, 500) : String(e.stack || 'no stack').substring(0, 500);
                log.error('Agent iteration error', { iteration: iteration, error: e.message, stack: errorStack });
                
                addAgentDebug('EXCEPTION', {
                    iteration: iteration,
                    error: e.message,
                    stack: errorStack
                });
                
                steps[steps.length - 1].status = 'error';
                steps[steps.length - 1].error = e.message;
                steps[steps.length - 1]._errorStack = errorStack.substring(0, 300);
                break;
            }
        }
        
        return buildFallbackResponse(message, toolResults, steps, startTime, fiscalContext);
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // MULTI-STEP PLAN EXECUTION
    // Coordinated execution of multiple steps with parameter substitution and synthesis
    // ═══════════════════════════════════════════════════════════════════════════════
    
    /**
     * Execute a multi-step plan with coordinated queries and synthesis
     * Each step can be a template, custom query, or synthesis
     * Steps can have parameters, dependencies, and output aliases
     */
    function executeMultiStepPlan(message, plan, history, fiscalContext, steps, startTime, sessionContext, resolvedEntities) {
        log.audit('Executing multi-step plan', {
            stepCount: plan.plan ? plan.plan.length : 0,
            strategy: plan.execution_strategy,
            requiresSynthesis: plan.requires_synthesis
        });
        
        var stepResults = {};  // Keyed by output_alias or step number
        var allRichContent = [];
        var queryHistory = [];
        var llmCalls = [];
        
        // Build substitution context (fiscal dates + resolved entities)
        var substitutionContext = buildSubstitutionContext(fiscalContext, resolvedEntities);
        
        addAgentDebug('Multi-step plan start', {
            planSteps: plan.plan,
            substitutionContext: Object.keys(substitutionContext)
        });
        
        // Execute each step in order
        var planSteps = plan.plan || [];
        for (var i = 0; i < planSteps.length; i++) {
            var planStep = planSteps[i];
            var stepKey = planStep.output_alias || String(planStep.step);
            
            // Check governance
            var govCheck = Utils.checkGovernance(500);
            if (!govCheck.hasEnough) {
                log.audit('Multi-step stopping due to low governance', { step: i, remaining: govCheck.remaining });
                break;
            }
            
            steps.push({
                type: 'agent_step',
                title: planStep.purpose || ('Step ' + planStep.step),
                status: 'running',
                timestamp: Date.now()
            });
            
            var stepStartTime = Date.now();
            var stepResult = null;
            
            try {
                switch (planStep.action) {
                    case 'resolve_entity':
                        // Entity resolution is done BEFORE agent loop in orchestrator
                        // Skip this step - entities are already in resolvedEntities
                        log.debug('Skipping resolve_entity step - already resolved', { 
                            step: planStep.step,
                            resolvedEntities: Object.keys(resolvedEntities || {})
                        });
                        stepResult = { 
                            success: true, 
                            skipped: true,
                            message: 'Entity already resolved before execution'
                        };
                        break;
                    
                    case 'dashboard':
                        // Execute dashboard query
                        stepResult = executeDashboardStep(planStep, fiscalContext);
                        break;
                        
                    case 'template':
                        stepResult = executeTemplateStep(planStep, substitutionContext, fiscalContext, history, resolvedEntities);
                        break;
                        
                    case 'query':
                        stepResult = executeQueryStep(planStep, stepResults, substitutionContext, fiscalContext, history, message, resolvedEntities);
                        break;
                        
                    case 'synthesize':
                        stepResult = executeSynthesisStep(planStep, stepResults, message, fiscalContext);
                        break;
                        
                    default:
                        log.error('Unknown step action', { action: planStep.action, step: planStep.step });
                        stepResult = { success: false, error: 'Unknown action: ' + planStep.action };
                }
            } catch (e) {
                log.error('Step execution error', { step: planStep.step, error: e.message });
                stepResult = { success: false, error: e.message };
            }
            
            var stepDuration = Date.now() - stepStartTime;
            
            // Update step status
            var currentStep = steps[steps.length - 1];
            if (stepResult && stepResult.success) {
                currentStep.status = 'complete';
                currentStep.rowCount = stepResult.rowCount;
                currentStep.sql = stepResult.sql;
                currentStep.content = stepResult.summary || ('Found ' + (stepResult.rowCount || 0) + ' results');
                
                // Store result for later steps
                stepResults[stepKey] = stepResult;
                
                // Track query history
                if (stepResult.sql) {
                    queryHistory.push({
                        query: stepResult.sql,
                        columns: stepResult.columns || [],
                        rows: stepResult.rows || [],
                        rowCount: stepResult.rowCount || 0,
                        timestamp: Date.now()
                    });
                }
                
                // Track LLM calls
                if (stepResult.llmCall) {
                    llmCalls.push(stepResult.llmCall);
                }
                
                // Add rich content (if not synthesis - synthesis goes at the top)
                if (planStep.action !== 'synthesize' && stepResult.richContent) {
                    allRichContent = allRichContent.concat(stepResult.richContent);
                }
            } else {
                currentStep.status = 'error';
                currentStep.error = stepResult ? stepResult.error : 'Unknown error';
                
                // Include synthesis debug info if available
                if (stepResult && stepResult._synthesisDebugInfo) {
                    currentStep._synthesisDebugInfo = stepResult._synthesisDebugInfo;
                }
                
                // Store failed result so synthesis knows what's missing
                stepResults[stepKey] = { success: false, error: currentStep.error };
            }
            
            addAgentDebug('Step completed', {
                step: planStep.step,
                action: planStep.action,
                success: stepResult ? stepResult.success : false,
                duration: stepDuration,
                resultKey: stepKey
            });
        }
        
        // ═══════════════════════════════════════════════════════════════
        // FIX: Check requires_synthesis flag even if no synthesize step in plan
        // The LLM may set requires_synthesis: true without adding an explicit step
        // ═══════════════════════════════════════════════════════════════
        var synthesisResult = stepResults['synthesis'] || stepResults[String(planSteps.length)];
        
        // If no synthesis was done but plan.requires_synthesis is true, do it now
        if (!synthesisResult && plan.requires_synthesis && Object.keys(stepResults).length > 1) {
            addAgentDebug('Auto-triggering synthesis (requires_synthesis flag set)', {
                stepCount: Object.keys(stepResults).length,
                synthesis_instructions: plan.synthesis_instructions
            });
            
            // Gather all results for synthesis
            var allResultsForSynthesis = [];
            Object.keys(stepResults).forEach(function(key) {
                var result = stepResults[key];
                if (result && result.success && !result.skipped && result.rows) {
                    allResultsForSynthesis.push({
                        templateId: result.templateId || 'query_' + key,
                        templateName: result.templateName || result.purpose || 'Query ' + key,
                        purpose: result.purpose || '',
                        rows: result.rows || [],
                        columns: result.columns || [],
                        rowCount: result.rowCount || 0
                    });
                }
            });
            
            if (allResultsForSynthesis.length > 0) {
                steps.push({
                    type: 'synthesis',
                    title: 'Synthesizing results',
                    status: 'running',
                    timestamp: Date.now()
                });
                
                var synthStartTime = Date.now();
                synthesisResult = QueryExecution.synthesizeMultiTemplateResults(
                    message,
                    allResultsForSynthesis,
                    plan.synthesis_instructions || 'Summarize and connect the data from these queries.',
                    fiscalContext
                );
                
                var synthDuration = Date.now() - synthStartTime;
                steps[steps.length - 1].status = 'complete';
                steps[steps.length - 1].duration = synthDuration;
                
                // Track LLM call
                llmCalls.push({
                    purpose: 'Synthesis',
                    model: synthesisResult.model || 'unknown',
                    provider: synthesisResult.provider || 'unknown',
                    duration: synthDuration,
                    type: 'synthesis',
                    tier: 2
                });
                
                // Build rich content from synthesis
                if (synthesisResult.success) {
                    synthesisResult.richContent = [];
                    if (synthesisResult.summary) {
                        synthesisResult.richContent.push({
                            type: 'text',
                            content: synthesisResult.summary
                        });
                    }
                    if (synthesisResult.insights && synthesisResult.insights.length > 0) {
                        synthesisResult.richContent.push({
                            type: 'callout',
                            variant: 'info',
                            content: '**Key Insights:**\n\n' + synthesisResult.insights.map(function(i) { return '• ' + i; }).join('\n')
                        });
                    }
                }
            }
        }
        
        // Build final response
        var finalRichContent = [];
        
        // If we have synthesis, put it first
        if (synthesisResult && synthesisResult.success && synthesisResult.richContent) {
            finalRichContent = finalRichContent.concat(synthesisResult.richContent);
        } else if (synthesisResult && !synthesisResult.success && allRichContent.length > 0) {
            // Synthesis failed but we have data - add graceful degradation message
            finalRichContent.push({
                type: 'callout',
                variant: 'warning',
                content: '**Note:** Analysis could not be completed, but here is the data:'
            });
        }
        
        // Then add data tables from each step
        finalRichContent = finalRichContent.concat(allRichContent);
        
        // ═══════════════════════════════════════════════════════════════
        // LLM CALL TRACKING FIX: Clear global log to prevent duplicates
        // We track our own llmCalls array, so don't let ResponseBuilder add another
        // ═══════════════════════════════════════════════════════════════
        AIProviders.getAndClearAICallLog();  // Clear global log to prevent duplicate block
        
        // Add LLM calls summary BEFORE building response (so it's part of steps)
        if (llmCalls.length > 0) {
            var totalLLMTime = llmCalls.reduce(function(sum, c) { return sum + (c.duration || 0); }, 0);
            steps.push({
                type: 'llm_calls',
                title: llmCalls.length + ' LLM calls (' + Math.round(totalLLMTime / 1000) + 's)',
                calls: llmCalls,
                status: 'complete',
                timestamp: Date.now()
            });
        }
        
        // Build response (global log already cleared, won't add duplicate)
        var response = ResponseBuilder.buildResponse('', steps, startTime, AIProviders.getCurrentModelInfo());
        response.richContent = finalRichContent;
        response.blocksFormat = true;
        
        // Update session context
        response.sessionContext = Planning.updateSessionContext(sessionContext, {
            queryHistory: queryHistory,
            lastQueryResult: queryHistory.length > 0 ? queryHistory[queryHistory.length - 1] : null
        });
        
        // Add follow-up suggestions
        ResponseBuilder.addContextualSuggestions(response);
        
        if (Utils.isDebugMode()) {
            response._agentDebugLog = getAndClearAgentDebugLog();
        }
        
        return finalizeResponse(response, response.sessionContext);
    }
    
    /**
     * Build substitution context from fiscal context and resolved entities
     * All values available as {variableName} in params
     */
    function buildSubstitutionContext(fiscalContext, resolvedEntities) {
        var context = {};
        
        // Add all fiscal context values
        if (fiscalContext) {
            Object.keys(fiscalContext).forEach(function(key) {
                context[key] = fiscalContext[key];
            });
        }
        
        // Add resolved entities as nested object
        // Accessible as {resolvedEntities.termname.id} or {resolvedEntities.termname.name}
        context.resolvedEntities = {};
        if (resolvedEntities) {
            Object.keys(resolvedEntities).forEach(function(term) {
                var entity = resolvedEntities[term];
                context.resolvedEntities[term] = {
                    id: entity.id,
                    name: entity.name,
                    type: entity.type
                };
                // Also add flat version for convenience: {entity_termname_id}
                context['entity_' + term.replace(/\s+/g, '_') + '_id'] = entity.id;
                context['entity_' + term.replace(/\s+/g, '_') + '_name'] = entity.name;
            });
        }
        
        return context;
    }
    
    /**
     * Substitute {variable} placeholders in a value
     */
    function substituteVariables(value, context) {
        if (typeof value !== 'string') return value;
        
        return value.replace(/\{([^}]+)\}/g, function(match, path) {
            // Handle nested paths like {resolvedEntities.acme.id}
            var parts = path.split('.');
            var current = context;
            
            for (var i = 0; i < parts.length; i++) {
                if (current === undefined || current === null) return match;
                current = current[parts[i]];
            }
            
            return current !== undefined ? current : match;
        });
    }
    
    /**
     * Substitute variables in all params
     */
    function substituteParams(params, context) {
        if (!params) return {};
        
        var result = {};
        Object.keys(params).forEach(function(key) {
            var value = params[key];
            if (typeof value === 'string') {
                result[key] = substituteVariables(value, context);
            } else if (Array.isArray(value)) {
                result[key] = value.map(function(v) {
                    return typeof v === 'string' ? substituteVariables(v, context) : v;
                });
            } else if (typeof value === 'object' && value !== null) {
                result[key] = substituteParams(value, context);
            } else {
                result[key] = value;
            }
        });
        
        return result;
    }
    
    /**
     * Execute a dashboard step
     * Fetches dashboard data and formats it for use in multi-step plans
     */
    function executeDashboardStep(planStep, fiscalContext) {
        var dashboardId = planStep.dashboard_id || planStep.dashboard;
        
        // Try to infer dashboard from purpose if not specified
        if (!dashboardId && planStep.purpose) {
            var purposeLower = planStep.purpose.toLowerCase();
            if (purposeLower.includes('cash') || purposeLower.includes('payment') || purposeLower.includes('payable') || purposeLower.includes('receivable')) {
                dashboardId = 'cashflow';
            } else if (purposeLower.includes('health') || purposeLower.includes('revenue') || purposeLower.includes('profit')) {
                dashboardId = 'health';
            } else if (purposeLower.includes('burden') || purposeLower.includes('utilization')) {
                dashboardId = 'burden';
            }
        }
        
        if (!dashboardId) {
            return { 
                success: false, 
                error: 'No dashboard specified for dashboard step' 
            };
        }
        
        log.debug('Executing dashboard step', { dashboardId: dashboardId, purpose: planStep.purpose });
        
        // Execute dashboard
        var dashResult = DashboardHandler.executeAgentDashboard({ dashboard: dashboardId }, fiscalContext);
        
        if (!dashResult.success) {
            return { 
                success: false, 
                error: dashResult.error || 'Dashboard fetch failed',
                dashboardId: dashboardId
            };
        }
        
        // Summarize dashboard for context
        var summary = DashboardHandler.summarizeDashboardForAgent(dashboardId, dashResult.data);
        
        // Build rich content showing key metrics
        var richContent = [];
        richContent.push({
            type: 'text',
            content: '**Dashboard: ' + dashboardId.charAt(0).toUpperCase() + dashboardId.slice(1) + '**'
        });
        
        // Extract key metrics for display
        if (dashResult.data) {
            // For cashflow dashboard, show cash position
            if (dashboardId === 'cashflow' && dashResult.data.cashPosition) {
                var cp = dashResult.data.cashPosition;
                richContent.push({
                    type: 'callout',
                    variant: 'info',
                    content: '**Current Cash Position:** ' + (cp.currentCash ? '$' + Number(cp.currentCash).toLocaleString() : 'N/A')
                });
            }
            
            // For health dashboard, show key metrics
            if (dashboardId === 'health' && dashResult.data.summary) {
                var hs = dashResult.data.summary;
                richContent.push({
                    type: 'callout',
                    variant: 'info',
                    content: '**Revenue:** ' + (hs.revenue ? '$' + Number(hs.revenue).toLocaleString() : 'N/A') + 
                             ' | **Expenses:** ' + (hs.expenses ? '$' + Number(hs.expenses).toLocaleString() : 'N/A')
                });
            }
        }
        
        return {
            success: true,
            dashboardId: dashboardId,
            data: dashResult.data,
            summary: summary,
            purpose: planStep.purpose,
            richContent: richContent,
            // Store structured data for synthesis
            rows: [{ dashboard: dashboardId, data: dashResult.data }],
            columns: ['dashboard', 'data'],
            rowCount: 1
        };
    }
    
    /**
     * Execute a template step
     */
    function executeTemplateStep(planStep, substitutionContext, fiscalContext, history, resolvedEntities) {
        var templateId = planStep.template_id;
        
        // ═══════════════════════════════════════════════════════════════
        // AUTO-CORRECT TEMPLATE based on resolved entity type
        // If LLM picked a customer template but entity is vendor (or vice versa),
        // switch to the correct template
        // ═══════════════════════════════════════════════════════════════
        if (resolvedEntities && Object.keys(resolvedEntities).length > 0) {
            var hasVendorEntity = false;
            var hasCustomerEntity = false;
            
            for (var term in resolvedEntities) {
                if (resolvedEntities.hasOwnProperty(term)) {
                    var entity = resolvedEntities[term];
                    if (entity.type === 'vendor') hasVendorEntity = true;
                    if (entity.type === 'customer') hasCustomerEntity = true;
                }
            }
            
            var CUSTOMER_TO_VENDOR_TEMPLATES = {
                'customer_payment_history': 'recent_vendor_transactions',
                'latest_customer_transaction': 'latest_vendor_transaction',
                'transactions_by_customer': 'transactions_by_vendor',
                'recent_customer_transactions': 'recent_vendor_transactions',
                'recent_customer_payments': 'recent_vendor_transactions',
                'customer_days_to_pay': 'transactions_by_vendor'
            };
            
            var VENDOR_TO_CUSTOMER_TEMPLATES = {
                'transactions_by_vendor': 'transactions_by_customer',
                'latest_vendor_transaction': 'latest_customer_transaction',
                'recent_vendor_transactions': 'recent_customer_transactions'
            };
            
            // Entity is vendor but template is for customers
            if (hasVendorEntity && !hasCustomerEntity && CUSTOMER_TO_VENDOR_TEMPLATES[templateId]) {
                var newTemplateId = CUSTOMER_TO_VENDOR_TEMPLATES[templateId];
                log.debug('Auto-correcting template in multi-step: entity is vendor', {
                    original: templateId,
                    corrected: newTemplateId
                });
                templateId = newTemplateId;
            }
            
            // Entity is customer but template is for vendors
            if (hasCustomerEntity && !hasVendorEntity && VENDOR_TO_CUSTOMER_TEMPLATES[templateId]) {
                var newTemplateId2 = VENDOR_TO_CUSTOMER_TEMPLATES[templateId];
                log.debug('Auto-correcting template in multi-step: entity is customer', {
                    original: templateId,
                    corrected: newTemplateId2
                });
                templateId = newTemplateId2;
            }
        }
        
        var template = Templates.getTemplate(templateId);
        
        if (!template) {
            return { success: false, error: 'Template not found: ' + templateId };
        }
        
        // Build params: start with extracted params, then override with step params
        var baseParams = extractTemplateParams(template, '', history, { plan: [planStep] }, resolvedEntities);
        var stepParams = substituteParams(planStep.params || {}, substitutionContext);
        var filterParams = substituteParams(planStep.filters || {}, substitutionContext);
        
        // Merge: base < step < filters
        var finalParams = Object.assign({}, baseParams, stepParams, filterParams);
        
        // Map entity_id to the correct parameter name for this template
        if (filterParams.entity_id && template.parameters) {
            template.parameters.forEach(function(p) {
                if (p.type === 'number' && (p.name.includes('customer_id') || p.name.includes('vendor_id') || p.name.includes('department_id') || p.name.includes('entity_id'))) {
                    finalParams[p.name] = filterParams.entity_id;
                }
            });
        }
        
        addAgentDebug('Template step params', {
            templateId: templateId,
            baseParams: baseParams,
            stepParams: stepParams,
            filterParams: filterParams,
            finalParams: finalParams
        });
        
        // Build and execute query
        var query = QueryExecution.buildQueryFromTemplate(template, finalParams, fiscalContext);
        var result = QueryExecutor.executeQuery(query);
        
        if (!result.success) {
            return { success: false, error: result.error, sql: query };
        }
        
        // Build rich content
        var richContent = [];
        richContent.push({
            type: 'text',
            content: '**' + (template.name || templateId) + '**'
        });
        
        if (result.rows && result.rows.length > 0) {
            var tableItem = {
                type: 'table',
                columns: result.columns,
                rows: result.rows
            };
            
            // Apply template formatting if available
            if (template.resultFormat) {
                tableItem.formatting = template.resultFormat.formatting;
                tableItem.variant = template.resultFormat.variant;
                tableItem.groupBy = template.resultFormat.groupBy;
                tableItem.calculatedTotals = template.resultFormat.calculatedTotals;
            }
            
            richContent.push(tableItem);
        } else {
            richContent.push({
                type: 'text',
                content: '_No data found for this query._'
            });
        }
        
        return {
            success: true,
            rows: result.rows,
            columns: result.columns,
            rowCount: result.rowCount,
            sql: query,
            templateId: templateId,
            templateName: template.name,
            purpose: planStep.purpose,
            richContent: richContent
        };
    }
    
    /**
     * Execute a custom query step
     */
    function executeQueryStep(planStep, priorResults, substitutionContext, fiscalContext, history, message, resolvedEntities) {
        var queryGuidance = planStep.query_guidance || planStep.purpose;
        
        // ═══════════════════════════════════════════════════════════════
        // FIX: ENTITY CONTEXT - Only inject if RELEVANT to this query
        // Stale entities from previous questions should NOT force filtering
        // ═══════════════════════════════════════════════════════════════
        var entityContext = '';
        if (resolvedEntities && Object.keys(resolvedEntities).length > 0) {
            // Check which entities are actually mentioned in the current context
            var messageLower = (message || '').toLowerCase();
            var purposeLower = (queryGuidance || '').toLowerCase();
            var contextText = messageLower + ' ' + purposeLower;
            
            var relevantEntities = {};
            var irrelevantEntities = {};
            
            for (var term in resolvedEntities) {
                if (resolvedEntities.hasOwnProperty(term)) {
                    var termLower = term.toLowerCase();
                    var data = resolvedEntities[term];
                    var nameLower = (data.name || '').toLowerCase();
                    
                    // Check if this entity is mentioned in the current query/purpose
                    var isRelevant = contextText.includes(termLower) || 
                                     contextText.includes(nameLower) ||
                                     contextText.includes(nameLower.split(' ')[0]); // First word of name
                    
                    // Also check for pronouns that might reference entity type
                    if (!isRelevant && data.type === 'vendor') {
                        isRelevant = contextText.includes('vendor') || contextText.includes('them') || contextText.includes('their');
                    }
                    if (!isRelevant && data.type === 'customer') {
                        isRelevant = contextText.includes('customer') || contextText.includes('them') || contextText.includes('their');
                    }
                    
                    if (isRelevant) {
                        relevantEntities[term] = data;
                    } else {
                        irrelevantEntities[term] = data;
                    }
                }
            }
            
            // Only add mandatory filter context for RELEVANT entities
            if (Object.keys(relevantEntities).length > 0) {
                entityContext = '\n\n══════════════════════════════════════════════════════════════\n';
                entityContext += '🚨 RESOLVED ENTITIES - FILTER QUERIES BY THESE 🚨\n';
                entityContext += '══════════════════════════════════════════════════════════════\n';
                for (var rTerm in relevantEntities) {
                    if (relevantEntities.hasOwnProperty(rTerm)) {
                        var rData = relevantEntities[rTerm];
                        entityContext += '• "' + rTerm + '" → ' + rData.name + ' (' + rData.type + ', internal ID: ' + rData.id + ')\n';
                    }
                }
                entityContext += '\nCRITICAL: Your query MUST filter by these entities!\n';
                entityContext += 'Use: WHERE transaction.entity = ' + Object.values(relevantEntities)[0].id + '\n';
                entityContext += '══════════════════════════════════════════════════════════════\n';
            }
            
            // Mention irrelevant entities as available but NOT required
            if (Object.keys(irrelevantEntities).length > 0 && Object.keys(relevantEntities).length === 0) {
                entityContext = '\n\n📋 PREVIOUSLY RESOLVED ENTITIES (for reference only - NOT required for this query):\n';
                for (var iTerm in irrelevantEntities) {
                    if (irrelevantEntities.hasOwnProperty(iTerm)) {
                        var iData = irrelevantEntities[iTerm];
                        entityContext += '• "' + iTerm + '" = ' + iData.name + ' (' + iData.type + ', ID: ' + iData.id + ')\n';
                    }
                }
                entityContext += 'Note: Only filter by these if the current query specifically mentions them.\n';
            }
        }
        
        // ═══════════════════════════════════════════════════════════════
        // CONVERSATION CONTEXT - Help disambiguate based on prior messages
        // ═══════════════════════════════════════════════════════════════
        var conversationContext = '';
        if (history && history.length > 0) {
            // Look at recent history to understand context (vendor vs customer focus)
            var recentHistory = history.slice(-4);  // Last 2 exchanges
            var vendorMentions = 0;
            var customerMentions = 0;
            var mentionedEntities = [];
            
            recentHistory.forEach(function(msg) {
                var content = (msg.content || '').toLowerCase();
                // Check for vendor-related keywords
                if (content.match(/\b(vendor|supplier|bill|vendbill|ap|payable|purchase|bought|paid to|paying)\b/i)) {
                    vendorMentions++;
                }
                // Check for customer-related keywords  
                if (content.match(/\b(customer|client|invoice|custinvc|ar|receivable|sold|revenue|billed to)\b/i)) {
                    customerMentions++;
                }
                // Extract mentioned company names from assistant responses (often contain resolved entities)
                var entityMatch = content.match(/(?:vendor|customer|from|to|for)\s*[:\-]?\s*["']?([A-Z][a-zA-Z0-9\s&]+(?:Inc|Ltd|Corp|LLC|Company)?)/g);
                if (entityMatch) {
                    mentionedEntities = mentionedEntities.concat(entityMatch);
                }
            });
            
            // Build context hint for query generator
            if (vendorMentions > customerMentions) {
                conversationContext = '\n\n⚠️ CONVERSATION CONTEXT: Recent discussion focused on VENDORS/AP. ' +
                    'When user says "invoices" without specifying, they likely mean VENDOR BILLS (VendBill), not customer invoices.\n';
            } else if (customerMentions > vendorMentions) {
                conversationContext = '\n\n⚠️ CONVERSATION CONTEXT: Recent discussion focused on CUSTOMERS/AR. ' +
                    'When user says "invoices", they likely mean CUSTOMER INVOICES (CustInvc).\n';
            }
            
            if (mentionedEntities.length > 0) {
                conversationContext += 'Recently mentioned entities: ' + mentionedEntities.slice(0, 3).join(', ') + '\n';
            }
        }
        
        // Build context from prior results if specified
        // ═══════════════════════════════════════════════════════════════
        // CRITICAL: Don't limit to 5 rows - this causes incorrect financial results
        // Instead: Extract ALL IDs/keys and guide LLM to use subqueries
        // ═══════════════════════════════════════════════════════════════
        var priorResultsContext = '';
        if (planStep.depends_on && planStep.depends_on.length > 0) {
            planStep.depends_on.forEach(function(depStep) {
                var depResult = priorResults[String(depStep)] || priorResults[planStep.inputs && planStep.inputs[depStep - 1]];
                if (depResult && depResult.success) {
                    priorResultsContext += '\n\nData from step ' + depStep + ':\n';
                    priorResultsContext += 'Columns: ' + (depResult.columns || []).join(', ') + '\n';
                    priorResultsContext += 'Row count: ' + (depResult.rowCount || 0) + '\n';
                    
                    if (depResult.rows && depResult.rows.length > 0) {
                        // Find ID/key columns
                        var idColumns = ['id', 'internalid', 'internal_id', 'customer_id', 'vendor_id', 
                                        'entity_id', 'item_id', 'transaction_id', 'tranid'];
                        var keyColumn = null;
                        var keyValues = [];
                        
                        // Find the first ID column that exists
                        var cols = Object.keys(depResult.rows[0]).map(function(k) { return k.toLowerCase(); });
                        for (var i = 0; i < idColumns.length; i++) {
                            if (cols.indexOf(idColumns[i]) >= 0) {
                                keyColumn = Object.keys(depResult.rows[0]).find(function(k) { 
                                    return k.toLowerCase() === idColumns[i]; 
                                });
                                break;
                            }
                        }
                        
                        // Extract ALL key values (up to 500 to prevent token overflow)
                        if (keyColumn) {
                            keyValues = depResult.rows.slice(0, 500).map(function(r) { 
                                return r[keyColumn]; 
                            }).filter(function(v) { return v != null; });
                            
                            priorResultsContext += '\n⚠️ CRITICAL: All ' + keyValues.length + ' ' + keyColumn + ' values from prior query:\n';
                            priorResultsContext += keyColumn + 's: [' + keyValues.join(', ') + ']\n';
                            
                            if (depResult.rowCount > 500) {
                                priorResultsContext += '⚠️ WARNING: Prior query returned ' + depResult.rowCount + ' rows but only first 500 IDs shown.\n';
                                priorResultsContext += 'Consider using a subquery instead of IN clause for large datasets.\n';
                            }
                        }
                        
                        // Show sample rows for context (but make clear this is just a sample)
                        priorResultsContext += '\nSample rows (for column reference only - use ALL IDs above):\n';
                        priorResultsContext += JSON.stringify(depResult.rows.slice(0, 3)) + '\n';
                        
                        // Add explicit guidance
                        priorResultsContext += '\n🚨 IMPORTANT: Your query MUST include ALL ' + (keyValues.length || depResult.rowCount) + ' records from the prior query.\n';
                        priorResultsContext += 'Options:\n';
                        priorResultsContext += '1. Use WHERE ' + (keyColumn || 'id') + ' IN (' + (keyValues.slice(0, 5).join(', ')) + ', ... ALL IDs)\n';
                        priorResultsContext += '2. Use a subquery: WHERE entity IN (SELECT entity FROM transaction WHERE ...)\n';
                        priorResultsContext += 'DO NOT limit to just 5 or a sample - use ALL values for accurate financial data.\n';
                    }
                }
            });
        }
        
        // Build RAG documents for query generation
        var ragDocuments = QueryExecution.buildRAGDocuments(message, fiscalContext, {});
        
        // Generate query via AI - include entity and conversation context
        var queryPrompt = queryGuidance + entityContext + conversationContext;
        if (priorResultsContext) {
            queryPrompt += '\n\nContext from prior steps:' + priorResultsContext;
        }
        
        var aiStartTime = Date.now();
        var aiResult = QueryExecution.generateQueryWithAI(queryPrompt, history, ragDocuments, fiscalContext, planStep.purpose);
        var aiDuration = Date.now() - aiStartTime;
        
        if (!aiResult || !aiResult.query) {
            return { 
                success: false, 
                error: 'Failed to generate query',
                llmCall: {
                    purpose: planStep.purpose,
                    duration: aiDuration,
                    type: 'query_generation',
                    tier: 2
                }
            };
        }
        
        // Execute the generated query
        var result = QueryExecutor.executeQuery(aiResult.query);
        
        if (!result.success) {
            return { 
                success: false, 
                error: result.error, 
                sql: aiResult.query,
                llmCall: {
                    purpose: planStep.purpose,
                    duration: aiDuration,
                    type: 'query_generation',
                    tier: 2
                }
            };
        }
        
        // Build rich content
        var richContent = [];
        richContent.push({
            type: 'text',
            content: '**' + (planStep.purpose || 'Query Results') + '**'
        });
        
        if (result.rows && result.rows.length > 0) {
            richContent.push({
                type: 'table',
                columns: result.columns,
                rows: result.rows
            });
        }
        
        return {
            success: true,
            rows: result.rows,
            columns: result.columns,
            rowCount: result.rowCount,
            sql: aiResult.query,
            purpose: planStep.purpose,
            richContent: richContent,
            llmCall: {
                purpose: planStep.purpose,
                model: aiResult.model,
                provider: aiResult.provider,
                duration: aiDuration,
                type: 'query_generation',
                tier: 2
            }
        };
    }
    
    /**
     * Execute a synthesis step
     */
    function executeSynthesisStep(planStep, stepResults, message, fiscalContext) {
        // Gather inputs
        var inputs = planStep.inputs || [];
        var allResults = [];
        
        // If no inputs specified, use all prior successful results
        if (inputs.length === 0) {
            Object.keys(stepResults).forEach(function(key) {
                if (key !== 'synthesis' && stepResults[key].success) {
                    allResults.push(stepResults[key]);
                }
            });
        } else {
            inputs.forEach(function(inputKey) {
                var result = stepResults[inputKey];
                if (result && result.success) {
                    allResults.push(result);
                }
            });
        }
        
        if (allResults.length === 0) {
            return {
                success: false,
                error: 'No data available for synthesis'
            };
        }
        
        // Call synthesis function
        var synthesisStartTime = Date.now();
        var synthesisResult = QueryExecution.synthesizeMultiTemplateResults(
            message,
            allResults.map(function(r) {
                return {
                    templateId: r.templateId || 'query',
                    templateName: r.templateName || r.purpose || 'Query Results',
                    purpose: r.purpose || '',
                    rows: r.rows || [],
                    columns: r.columns || [],
                    rowCount: r.rowCount || 0
                };
            }),
            planStep.synthesis_instructions || planStep.purpose,
            fiscalContext
        );
        var synthesisDuration = Date.now() - synthesisStartTime;
        
        if (!synthesisResult.success) {
            return {
                success: false,
                error: synthesisResult.error || 'Synthesis failed',
                _synthesisDebugInfo: synthesisResult._debugInfo,
                llmCall: {
                    purpose: 'Synthesis',
                    duration: synthesisDuration,
                    type: 'synthesis',
                    tier: 2
                }
            };
        }
        
        // Build rich content for synthesis
        var richContent = [];
        
        // Summary
        if (synthesisResult.summary) {
            richContent.push({
                type: 'text',
                content: synthesisResult.summary
            });
        }
        
        // Insights as callout
        if (synthesisResult.insights && synthesisResult.insights.length > 0) {
            richContent.push({
                type: 'callout',
                variant: 'info',
                content: '**Key Insights:**\n\n' + synthesisResult.insights.map(function(i) { return '• ' + i; }).join('\n')
            });
        }
        
        return {
            success: true,
            summary: synthesisResult.summary,
            insights: synthesisResult.insights,
            richContent: richContent,
            llmCall: {
                purpose: 'Synthesis',
                model: synthesisResult.model,
                provider: synthesisResult.provider,
                duration: synthesisDuration,
                type: 'synthesis',
                tier: 2
            }
        };
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // EXPORTS
    // ═══════════════════════════════════════════════════════════════════════════════
    return {
        executeSimplePlan: executeSimplePlan,
        executeAgenticPlan: executeAgenticPlan,
        executeMultiStepPlan: executeMultiStepPlan,
        
        // Response building (keep here - working implementations)
        buildAgentPrompt: buildAgentPrompt,
        buildAgentResponse: buildAgentResponse,
        buildFallbackResponse: buildFallbackResponse,
        
        // Query execution
        executeAgentQuery: executeAgentQuery,
        
        // Helper functions
        extractTemplateParams: extractTemplateParams,
        classifyQueryError: classifyQueryError,
        
        // Re-export from proper modules for backwards compatibility
        buildAgentSystemPrompt: Prompts.buildAgentSystemPrompt,
        buildPartialResponse: Utils.buildPartialResponse,
        executeAgentDashboard: DashboardHandler.executeAgentDashboard,
        executeEntityResolution: EntityResolver.executeEntityResolution,
        formatResultsCompact: Utils.formatResultsCompact,
        checkToolCompliance: ToolDefinitions.checkToolCompliance,
        checkGovernance: Utils.checkGovernance,
        getAgentToolsForPlan: ToolDefinitions.getAgentToolsForPlan,
        
        MAX_AGENT_ITERATIONS: MAX_AGENT_ITERATIONS,
        
        // Debug exports
        getAndClearAgentDebugLog: getAndClearAgentDebugLog
    };
});