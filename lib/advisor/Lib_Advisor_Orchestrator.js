/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * 
 * Lib_Advisor_Orchestrator.js
 * Main orchestration module for the AI Financial Advisor
 * 
 * REFACTORED: This file has been split into focused modules:
 * - Lib_Advisor_AIProviders.js    - AI provider implementations
 * - Lib_Advisor_EntityResolver.js - Entity resolution and fuzzy matching
 * - Lib_Advisor_AgentExecution.js - Multi-step agentic execution
 * - Lib_Advisor_QueryExecution.js - Query generation and execution
 * - Lib_Advisor_ResponseBuilder.js - Response building and rich content
 * - Lib_Advisor_DashboardHandler.js - Dashboard handling
 * - Lib_Advisor_Planning.js        - Planning and classification
 * - Lib_Advisor_ToolDefinitions.js - Tool schemas
 * - Lib_Advisor_Utils.js          - Shared utilities
 * 
 * This file now serves as the entry point and public API.
 */
define([
    'N/log',
    './Lib_Advisor_AIProviders',
    './Lib_Advisor_EntityResolver',
    './Lib_Advisor_AgentExecution',
    './Lib_Advisor_QueryExecution',
    './Lib_Advisor_ResponseBuilder',
    './Lib_Advisor_DashboardHandler',
    './Lib_Advisor_Planning',
    './Lib_Advisor_ToolDefinitions',
    './Lib_Advisor_Utils',
    './Lib_Advisor_Prompts',
    './Lib_Advisor_QueryExecutor',
    '../Lib_Config',
    './Lib_Advisor_Templates'
], function(
    log,
    AIProviders,
    EntityResolver,
    AgentExecution,
    QueryExecution,
    ResponseBuilder,
    DashboardHandler,
    Planning,
    ToolDefinitions,
    Utils,
    Prompts,
    QueryExecutor,
    ConfigLib,
    Templates
) {
    'use strict';

    // ═══════════════════════════════════════════════════════════════════════════════
    // MAIN ENTRY POINT - processChat
    // ═══════════════════════════════════════════════════════════════════════════════

    /**
     * Extract potential entity names from a message
     * Simple heuristic extraction - no LLM needed
     * 
     * Looks for:
     * - Capitalized words/phrases (proper nouns)
     * - Quoted strings
     * - Words after "from", "to", "for", "by" (likely entity references)
     * 
     * Filters out:
     * - Common words (the, a, an, etc.)
     * - Date/time words
     * - Financial terms that aren't entities
     */
    function extractPotentialEntities(message) {
        if (!message) return [];
        
        const potentialEntities = new Set();
        
        // Common words to exclude
        const stopWords = new Set([
            'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
            'from', 'up', 'about', 'into', 'over', 'after', 'beneath', 'under', 'above',
            'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he', 'she', 'it', 'they', 'them',
            'this', 'that', 'these', 'those', 'what', 'which', 'who', 'whom', 'how', 'when', 'where', 'why',
            'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did',
            'will', 'would', 'could', 'should', 'may', 'might', 'must', 'shall', 'can',
            'get', 'find', 'show', 'give', 'tell', 'list', 'display', 'fetch', 'pull', 'retrieve',
            'all', 'any', 'some', 'no', 'not', 'only', 'just', 'also', 'very', 'too', 'so', 'than', 'then',
            'now', 'here', 'there', 'today', 'yesterday', 'tomorrow', 'last', 'next', 'first', 'latest',
            'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
            'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
            'year', 'month', 'week', 'day', 'quarter', 'ytd', 'mtd', 'qtd', 'yoy',
            'invoice', 'invoices', 'bill', 'bills', 'payment', 'payments', 'order', 'orders',
            'transaction', 'transactions', 'expense', 'expenses', 'revenue', 'sales', 'purchase',
            'customer', 'customers', 'vendor', 'vendors', 'employee', 'employees', 'item', 'items',
            'total', 'sum', 'average', 'count', 'amount', 'balance', 'profit', 'loss', 'margin',
            'top', 'bottom', 'highest', 'lowest', 'most', 'least', 'best', 'worst',
            'please', 'thanks', 'thank', 'help', 'need', 'want', 'like', 'would'
        ]);
        
        // 1. Extract quoted strings (highest confidence)
        const quotedPattern = /["']([^"']+)["']/g;
        let match;
        while ((match = quotedPattern.exec(message)) !== null) {
            const term = match[1].trim();
            if (term.length >= 2 && term.length <= 50) {
                potentialEntities.add(term);
            }
        }
        
        // 2. Extract words/phrases after directional prepositions
        // "from Oracle" → Oracle is likely an entity
        // "to Acme Corp" → Acme Corp is likely an entity
        // Also handles lowercase: "from birla", "to oracle"
        const prepositionPattern = /(?:from|to|for|by|with)\s+([A-Za-z][A-Za-z0-9]*(?:\s+[A-Za-z][A-Za-z0-9]*)*)/gi;
        while ((match = prepositionPattern.exec(message)) !== null) {
            const term = match[1].trim();
            if (term.length >= 2 && !stopWords.has(term.toLowerCase())) {
                potentialEntities.add(term);
            }
        }
        
        // 3. Extract capitalized words that aren't at sentence start
        // Split into sentences, then find capitalized words not at start
        const words = message.split(/\s+/);
        for (let i = 1; i < words.length; i++) {
            const word = words[i].replace(/[.,!?;:'"()]/g, '');
            // Check if word starts with capital and isn't all caps (acronym handling)
            if (word.length >= 2 && /^[A-Z][a-z]/.test(word)) {
                if (!stopWords.has(word.toLowerCase())) {
                    potentialEntities.add(word);
                }
            }
            // Also capture multi-word proper nouns like "Acme Corp"
            if (word.length >= 2 && /^[A-Z]/.test(word) && i + 1 < words.length) {
                const nextWord = words[i + 1].replace(/[.,!?;:'"()]/g, '');
                if (/^[A-Z]/.test(nextWord) && !stopWords.has(nextWord.toLowerCase())) {
                    potentialEntities.add(word + ' ' + nextWord);
                }
            }
        }
        
        // 4. Extract ALL-CAPS words (company abbreviations like "IBM", "HP")
        const capsPattern = /\b([A-Z]{2,6})\b/g;
        while ((match = capsPattern.exec(message)) !== null) {
            const term = match[1];
            // Filter out common abbreviations that aren't entities
            const nonEntityCaps = new Set(['YTD', 'MTD', 'QTD', 'YOY', 'MOM', 'QOQ', 'AP', 'AR', 'GL', 'PO', 'SO', 'USD', 'CAD', 'EUR', 'SQL']);
            if (!nonEntityCaps.has(term)) {
                potentialEntities.add(term);
            }
        }
        
        // Convert to array and return
        return Array.from(potentialEntities);
    }

    /**
     * Pre-resolve entities before planning
     * This ensures we know entity types even if planning fails
     */
    function preResolveEntities(message, existingResolvedEntities) {
        const potentialEntities = extractPotentialEntities(message);
        const resolved = existingResolvedEntities || {};
        const newlyResolved = [];
        
        if (potentialEntities.length === 0) {
            return { resolved, newlyResolved, potentialEntities, mentionedExisting: [] };
        }
        
        log.debug('Pre-resolving entities', { 
            potentialEntities: potentialEntities,
            alreadyResolved: Object.keys(resolved)
        });
        
        // Track entities that were mentioned but already resolved (for recency tracking)
        const mentionedExisting = [];
        
        for (const term of potentialEntities) {
            const termLower = term.toLowerCase();
            
            // If already resolved, track it as "mentioned" but don't re-resolve
            if (resolved[termLower] && resolved[termLower].id) {
                mentionedExisting.push({
                    term: term,
                    entity: resolved[termLower]
                });
                continue;
            }
            
            // Try to resolve with auto-detection (tries all entity types)
            try {
                const result = EntityResolver.resolveEntityWithFallback(term, 'auto');
                
                if (result.resolved && result.entity) {
                    resolved[termLower] = {
                        id: result.entity.id,
                        name: result.entity.name,
                        type: result.actualType || 'unknown'
                    };
                    newlyResolved.push({
                        term: term,
                        entity: result.entity,
                        type: result.actualType
                    });
                    
                    log.debug('Pre-resolved entity', {
                        term: term,
                        entityName: result.entity.name,
                        entityType: result.actualType,
                        entityId: result.entity.id
                    });
                }
            } catch (e) {
                log.debug('Entity resolution failed', { term: term, error: e.message });
            }
        }
        
        return { resolved, newlyResolved, potentialEntities, mentionedExisting };
    }

    /**
     * Process a chat message and return AI-generated response
     * 
     * @param {Object} params - Chat parameters
     * @param {string} params.message - User's message
     * @param {Array} params.history - Conversation history
     * @param {Object} params.sessionContext - Persistent session context
     * @param {Object} params.aiSettings - AI settings including debugMode
     * @returns {Object} Response with text, steps, richContent, etc.
     */
    function processChat(params) {
        const startTime = Date.now();
        const message = params.message || '';
        const history = params.history || [];
        const sessionContext = params.sessionContext || {};
        const aiSettings = params.aiSettings || {};
        const steps = [];
        
        // Enable debug mode if requested via settings
        Utils.resetDebugModeCache();
        if (aiSettings.debugMode === true) {
            Utils.setForceDebugMode(true);
        }
        
        log.debug('Processing chat', { 
            messageLength: message.length, 
            historyLength: history.length,
            hasSessionContext: !!sessionContext,
            debugMode: Utils.isDebugMode()
        });
        
        try {
            // 1. Check for conversational patterns (no AI needed)
            const conversationalResponse = Planning.matchConversationalPattern(message);
            if (conversationalResponse) {
                var response = ResponseBuilder.buildResponse('', steps, startTime, AIProviders.getCurrentModelInfo());
                response.richContent = [{ type: 'text', content: conversationalResponse }];
                response.blocksFormat = true;
                return response;
            }
            
            // 2. Get fiscal context for the organization
            const fiscalContext = getFiscalContext();
            
            // 3. Prepare conversation history and session context
            const prepared = Planning.prepareConversationHistory(history, sessionContext);
            
            // ═══════════════════════════════════════════════════════════════
            // 3.5 PRE-RESOLVE ENTITIES (before planning, no LLM needed)
            // This ensures we know entity types even if planning fails
            // Note: Full entity resolution with proper recency tracking happens in
            // Planning.planExecution() via EntityResolver.resolveEntitiesInMessage()
            // ═══════════════════════════════════════════════════════════════
            const preResolution = preResolveEntities(message, prepared.sessionContext.resolvedEntities);
            
            // Update session context with pre-resolved entities
            prepared.sessionContext.resolvedEntities = preResolution.resolved;
            
            // Add step if we found and resolved any entities
            if (preResolution.newlyResolved.length > 0) {
                // Update entityOrder for recency tracking
                prepared.sessionContext.entityOrder = prepared.sessionContext.entityOrder || [];
                for (const r of preResolution.newlyResolved) {
                    const key = EntityResolver.normalizeEntityKey(r.entity.name);
                    const idx = prepared.sessionContext.entityOrder.indexOf(key);
                    if (idx >= 0) prepared.sessionContext.entityOrder.splice(idx, 1);
                    prepared.sessionContext.entityOrder.push(key);
                }
                
                steps.push({
                    type: 'pre_resolution',
                    title: 'Identifying entities',
                    status: 'complete',
                    timestamp: Date.now(),
                    content: preResolution.newlyResolved.map(r => 
                        `✓ "${r.term}" → ${r.entity.name} (${r.type})`
                    ).join('\n')
                });
                
                log.debug('Pre-resolved entities before planning', {
                    count: preResolution.newlyResolved.length,
                    entities: preResolution.newlyResolved.map(r => ({
                        term: r.term,
                        name: r.entity.name,
                        type: r.type
                    })),
                    entityOrder: prepared.sessionContext.entityOrder
                });
            }
            
            // ═══════════════════════════════════════════════════════════════
            // CRITICAL: Also update entityOrder for EXISTING entities that were
            // mentioned in THIS message. This ensures pronoun resolution works
            // correctly (e.g., "birla" mentioned again makes it "most recent")
            // ═══════════════════════════════════════════════════════════════
            if (preResolution.mentionedExisting && preResolution.mentionedExisting.length > 0) {
                prepared.sessionContext.entityOrder = prepared.sessionContext.entityOrder || [];
                for (const r of preResolution.mentionedExisting) {
                    const key = EntityResolver.normalizeEntityKey(r.entity.name);
                    const idx = prepared.sessionContext.entityOrder.indexOf(key);
                    if (idx >= 0) prepared.sessionContext.entityOrder.splice(idx, 1);
                    prepared.sessionContext.entityOrder.push(key);
                }
                
                log.debug('Updated recency for existing entities', {
                    count: preResolution.mentionedExisting.length,
                    entities: preResolution.mentionedExisting.map(r => r.term),
                    entityOrder: prepared.sessionContext.entityOrder
                });
            }
            
            // 4. Plan execution strategy (uses LLM to analyze query)
            steps.push({
                type: 'planning',
                title: 'Analyzing request',
                status: 'running',
                timestamp: Date.now()
            });
            
            const plan = Planning.planExecution(message, prepared.messages, fiscalContext, prepared.sessionContext);
            
            // Handle planning error - graceful failure
            if (plan.error) {
                steps[steps.length - 1].status = 'error';
                steps[steps.length - 1].plan = plan;
                
                log.debug('Planning failed', { 
                    errorMessage: plan.errorMessage,
                    reasoning: plan.reasoning
                });
                
                var errorResponse = ResponseBuilder.buildResponse('', steps, startTime, AIProviders.getCurrentModelInfo());
                errorResponse.richContent = [{ 
                    type: 'text', 
                    content: plan.errorMessage || 'I had trouble understanding this request. Could you try rephrasing it or breaking it into simpler questions?' 
                }];
                errorResponse.blocksFormat = true;
                return errorResponse;
            }
            
            steps[steps.length - 1].status = 'complete';
            steps[steps.length - 1].plan = plan;
            
            // ═══════════════════════════════════════════════════════════════
            // Merge entities from planning into sessionContext.resolvedEntities
            // NOTE: We only update resolvedEntities here, NOT entityOrder.
            // entityOrder is updated in pre-resolution (before Planning) for
            // entities mentioned in THIS request. This prevents old entities
            // (like "to_them" from a previous request) from becoming "most recent".
            // ═══════════════════════════════════════════════════════════════
            if (plan._planningResolvedEntities) {
                prepared.sessionContext.resolvedEntities = prepared.sessionContext.resolvedEntities || {};
                
                // Pattern to identify pronouns/coreferences that should NOT be cached
                const pronounPattern = /(^|_)(them|they|their|it|its|him|her|this|that)$/i;
                
                for (const key in plan._planningResolvedEntities) {
                    if (plan._planningResolvedEntities.hasOwnProperty(key)) {
                        // Skip pronoun keys - they should not be cached
                        if (pronounPattern.test(key)) {
                            continue;
                        }
                        
                        const entity = plan._planningResolvedEntities[key];
                        if (entity && entity.id) {
                            // Only add to dictionary, don't update entityOrder
                            const normalizedKey = EntityResolver.normalizeEntityKey(entity.name);
                            prepared.sessionContext.resolvedEntities[normalizedKey] = {
                                id: entity.id,
                                name: entity.name,
                                type: entity.type
                            };
                            // Also store with original key for direct lookups
                            // BUT: Skip if the original key is a pronoun
                            if (key !== normalizedKey && !pronounPattern.test(key)) {
                                prepared.sessionContext.resolvedEntities[key] = prepared.sessionContext.resolvedEntities[normalizedKey];
                            }
                        }
                    }
                }
                log.debug('Merged planning entities into sessionContext', {
                    count: Object.keys(plan._planningResolvedEntities).length,
                    entityOrder: prepared.sessionContext.entityOrder
                });
            }
            
            log.debug('Execution plan', {
                complexity: plan.complexity,
                template: plan.template_match,
                dashboard: plan.dashboard_suggestion,
                entitiesToResolve: plan.entities_to_resolve?.length || 0,
                estimatedQueries: plan.estimated_queries
            });
            
            // 5. Resolve entities if needed (before execution)
            const resolvedEntities = prepared.sessionContext.resolvedEntities || {};
            
            // Get preferred entity type from template if available
            let preferredEntityType = null;
            if (plan.template_match) {
                const template = Templates.getTemplate(plan.template_match);
                if (template && template.preferredEntityType) {
                    preferredEntityType = template.preferredEntityType;
                    log.debug('Template has preferred entity type', { 
                        template: plan.template_match, 
                        preferredType: preferredEntityType 
                    });
                }
                // Also infer from category if not explicitly set
                if (!preferredEntityType && template && template.category) {
                    const categoryToPreferredType = {
                        'AP': 'vendor',
                        'BILLS': 'vendor',
                        'VENDOR': 'vendor',
                        'AR': 'customer',
                        'INVOICES': 'customer',
                        'REVENUE': 'customer',
                        'CUSTOMER': 'customer'
                    };
                    preferredEntityType = categoryToPreferredType[template.category.toUpperCase()];
                }
            }
            
            if (plan.entities_to_resolve && plan.entities_to_resolve.length > 0) {
                // Filter out entities that are already resolved in session context
                const unresolvedEntities = plan.entities_to_resolve.filter(entity => {
                    if (!entity.term) return false;
                    const termLower = entity.term.toLowerCase();
                    return !resolvedEntities[termLower] || !resolvedEntities[termLower].id;
                });
                
                // Track entities resolved in THIS request (for template correction)
                const currentRequestEntities = {};
                
                if (unresolvedEntities.length > 0) {
                    steps.push({
                        type: 'resolving',
                        title: 'Resolving entities',
                        status: 'running',
                        timestamp: Date.now()
                    });
                    
                    const resolutionResults = [];
                    for (const entity of unresolvedEntities) {
                        if (!entity.term) continue; // Skip if no term
                        // Pass preferredEntityType to resolver for better type selection
                        const resolution = EntityResolver.resolveEntityWithFallback(
                            entity.term, 
                            entity.entity_type || 'auto',
                            preferredEntityType
                        );
                        resolutionResults.push({ term: entity.term, result: resolution });
                        
                        if (resolution.resolved && entity.term) {
                            const resolvedEntity = {
                                id: resolution.entity.id,
                                name: resolution.entity.name,
                                type: resolution.actualType || entity.entity_type
                            };
                            resolvedEntities[entity.term.toLowerCase()] = resolvedEntity;
                            // Track this as a current request entity
                            currentRequestEntities[entity.term.toLowerCase()] = resolvedEntity;
                            // Record with proper entityOrder tracking
                            EntityResolver.recordResolvedEntity(prepared.sessionContext, entity.term, resolvedEntity);
                        }
                    }
                    
                    // Update step with resolution results
                    const resolvedCount = resolutionResults.filter(r => r.result.resolved).length;
                    steps[steps.length - 1].status = 'complete';
                    steps[steps.length - 1].content = resolutionResults.map(r => {
                        if (r.result.resolved) {
                            return `✓ "${r.term}" → ${r.result.entity.name} (ID: ${r.result.entity.id})`;
                        } else {
                            return `✗ "${r.term}" not found`;
                        }
                    }).join('\n');
                    
                    // Store current request entities for template correction
                    plan._currentRequestEntities = currentRequestEntities;
                } else {
                    // All entities already resolved from previous messages
                    // But we still need to identify which ones are relevant to THIS request
                    plan._currentRequestEntities = {};
                    for (const entity of plan.entities_to_resolve) {
                        if (entity.term) {
                            const termLower = entity.term.toLowerCase();
                            if (resolvedEntities[termLower]) {
                                plan._currentRequestEntities[termLower] = resolvedEntities[termLower];
                                // Record with proper entityOrder tracking (brings to most recent)
                                EntityResolver.recordResolvedEntity(prepared.sessionContext, entity.term, resolvedEntities[termLower]);
                            }
                        }
                    }
                    
                    log.debug('All entities already resolved from session context', {
                        entities: plan.entities_to_resolve.map(e => e.term),
                        fromContext: Object.keys(resolvedEntities),
                        currentRequestEntities: Object.keys(plan._currentRequestEntities)
                    });
                }
            }
            
            // 5.5 AUTO-CORRECT TEMPLATE based on resolved entity type
            // If planner guessed wrong entity type but we resolved correctly, switch to correct template
            // IMPORTANT: Only use entities from the CURRENT request, not old session entities
            const entitiesForCorrection = plan._currentRequestEntities || {};
            
            if (plan.template_match && Object.keys(entitiesForCorrection).length > 0) {
                const CUSTOMER_TO_VENDOR_TEMPLATES = {
                    'customer_payment_history': 'recent_vendor_transactions',
                    'latest_customer_transaction': 'latest_vendor_transaction',
                    'transactions_by_customer': 'transactions_by_vendor',
                    'recent_customer_transactions': 'recent_vendor_transactions',
                    'recent_customer_payments': 'recent_vendor_transactions',
                    'customer_days_to_pay': 'transactions_by_vendor'
                };
                const VENDOR_TO_CUSTOMER_TEMPLATES = {
                    'transactions_by_vendor': 'transactions_by_customer',
                    'latest_vendor_transaction': 'latest_customer_transaction',
                    'recent_vendor_transactions': 'recent_customer_transactions'
                };
                
                // Check if any resolved entity type conflicts with template
                for (const term in entitiesForCorrection) {
                    if (entitiesForCorrection.hasOwnProperty(term)) {
                        const entity = entitiesForCorrection[term];
                        const templateId = plan.template_match;
                        
                        // Entity is vendor but template is for customers
                        if (entity.type === 'vendor' && CUSTOMER_TO_VENDOR_TEMPLATES[templateId]) {
                            const newTemplate = CUSTOMER_TO_VENDOR_TEMPLATES[templateId];
                            log.debug('Auto-correcting template: entity is vendor but template was for customers', {
                                originalTemplate: templateId,
                                newTemplate: newTemplate,
                                entity: entity.name
                            });
                            
                            // Add step to show the correction
                            steps.push({
                                type: 'correction',
                                title: 'Adjusted query type',
                                content: `"${entity.name}" is a vendor, not a customer. Using vendor template instead.`,
                                status: 'complete',
                                timestamp: Date.now()
                            });
                            
                            plan.template_match = newTemplate;
                            
                            // Also fix entities_to_resolve type for consistency
                            if (plan.entities_to_resolve) {
                                plan.entities_to_resolve.forEach(e => {
                                    if (e.term && e.term.toLowerCase() === term.toLowerCase() && e.entity_type === 'customer') {
                                        e.entity_type = 'vendor';
                                    }
                                });
                            }
                            break;
                        }
                        
                        // Entity is customer but template is for vendors
                        if (entity.type === 'customer' && VENDOR_TO_CUSTOMER_TEMPLATES[templateId]) {
                            const newTemplate = VENDOR_TO_CUSTOMER_TEMPLATES[templateId];
                            log.debug('Auto-correcting template: entity is customer but template was for vendors', {
                                originalTemplate: templateId,
                                newTemplate: newTemplate,
                                entity: entity.name
                            });
                            
                            // Add step to show the correction
                            steps.push({
                                type: 'correction',
                                title: 'Adjusted query type',
                                content: `"${entity.name}" is a customer, not a vendor. Using customer template instead.`,
                                status: 'complete',
                                timestamp: Date.now()
                            });
                            
                            plan.template_match = newTemplate;
                            
                            // Also fix entities_to_resolve type for consistency
                            if (plan.entities_to_resolve) {
                                plan.entities_to_resolve.forEach(e => {
                                    if (e.term && e.term.toLowerCase() === term.toLowerCase() && e.entity_type === 'vendor') {
                                        e.entity_type = 'customer';
                                    }
                                });
                            }
                            break;
                        }
                    }
                }
            }
            
            // Update session context with resolved entities
            // Note: entityOrder is managed by EntityResolver.recordResolvedEntity()
            const updatedSessionContext = Planning.updateSessionContext(prepared.sessionContext, {
                resolvedEntities: resolvedEntities
            });
            
            // 6. Execute plan based on execution_strategy (not just complexity)
            // Priority: multi_step > multi_template > agent > simple
            const strategy = plan.execution_strategy;
            
            // Use current request entities for template execution (not all session entities)
            // This prevents old entities from interfering with the current request
            const entitiesForExecution = plan._currentRequestEntities && Object.keys(plan._currentRequestEntities).length > 0
                ? plan._currentRequestEntities
                : resolvedEntities;
            
            let executionResult;
            if (strategy === 'multi_step' && plan.plan && plan.plan.length > 0) {
                // Coordinated multi-step execution with synthesis
                executionResult = AgentExecution.executeMultiStepPlan(message, plan, prepared.messages, fiscalContext, steps, startTime, updatedSessionContext, entitiesForExecution);
            } else if (strategy === 'multi_template' && plan.templates && plan.templates.length > 0) {
                // Multiple independent templates - handled in executeSimplePlan
                executionResult = AgentExecution.executeSimplePlan(message, plan, prepared.messages, fiscalContext, steps, startTime, updatedSessionContext, entitiesForExecution);
            } else if (plan.complexity === 'multi_step' && !['template', 'dashboard', 'custom_query'].includes(strategy)) {
                // Complex queries needing agent loop (fallback for old-style plans)
                executionResult = AgentExecution.executeAgenticPlan(message, plan, prepared.messages, fiscalContext, steps, startTime, updatedSessionContext);
            } else {
                // Simple: single template, dashboard, or custom query
                executionResult = AgentExecution.executeSimplePlan(message, plan, prepared.messages, fiscalContext, steps, startTime, updatedSessionContext, entitiesForExecution);
            }
            
            // ═══════════════════════════════════════════════════════════════════════════════
            // ESCALATION: If simple plan failed, try upgrading to multi-step approach
            // ═══════════════════════════════════════════════════════════════════════════════
            if (executionResult.needsReplan && plan.complexity === 'simple') {
                log.debug('Escalating to multi-step after simple plan failure', {
                    failureReason: executionResult.failureReason,
                    originalStrategy: strategy
                });
                
                steps.push({
                    type: 'escalation',
                    title: 'Trying alternative approach',
                    content: 'Initial approach did not yield results. Attempting more detailed analysis.',
                    status: 'running',
                    timestamp: Date.now()
                });
                
                // Re-plan with forceMultiStep
                const escalatedPlan = {
                    complexity: 'multi_step',
                    reasoning: 'Escalated from simple plan due to: ' + (executionResult.failureReason || 'query failure'),
                    plan: [
                        { step: 1, action: 'query', purpose: 'Explore available data structure' },
                        { step: 2, action: 'query', purpose: 'Query with adjusted approach' },
                        { step: 3, action: 'synthesize', purpose: 'Provide findings to user' }
                    ],
                    entities_to_resolve: plan.entities_to_resolve || [],
                    _planningResolvedEntities: plan._planningResolvedEntities || {},
                    estimated_queries: 3,
                    _escalatedFrom: plan
                };
                
                steps[steps.length - 1].status = 'complete';
                
                // Execute with agent loop for more flexibility
                const escalatedResult = AgentExecution.executeAgenticPlan(
                    message, 
                    escalatedPlan, 
                    prepared.messages, 
                    fiscalContext, 
                    steps, 
                    startTime, 
                    updatedSessionContext
                );
                
                // If escalation also fails, return original result with helpful message
                if (escalatedResult.needsReplan) {
                    executionResult.richContent = [{
                        type: 'text',
                        content: 'I tried multiple approaches but couldn\'t retrieve the data you requested. This might be because:\n\n' +
                            '• The data doesn\'t exist for the specified criteria\n' +
                            '• The record type or fields are not available in your NetSuite configuration\n' +
                            '• There may be permission restrictions\n\n' +
                            'Could you try rephrasing your question or checking if the data exists in NetSuite directly?'
                    }];
                    return executionResult;
                }
                
                return escalatedResult;
            }
            
            return executionResult;
            
        } catch (e) {
            log.error('Orchestrator Error', { message: e.message, stack: e.stack });
            steps.push({
                type: 'error',
                title: 'System Error',
                content: e.message,
                status: 'error',
                timestamp: Date.now()
            });
            var errorResponse = ResponseBuilder.buildResponse('', steps, startTime, AIProviders.getCurrentModelInfo());
            errorResponse.richContent = [{ type: 'text', content: 'An unexpected error occurred: ' + e.message }];
            errorResponse.blocksFormat = true;
            return errorResponse;
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // FISCAL CONTEXT - EXACT copy from original line 4650
    // ═══════════════════════════════════════════════════════════════════════════════

    /**
     * Get fiscal context for the organization
     * Uses ConfigLib.getFiscalCalendar() as single source of truth
     */
    function getFiscalContext(context) {
        var now = new Date();
        
        // Get fiscal calendar configuration from ConfigLib (single source of truth)
        var fiscalCalendar = { fiscalYearStartMonth: 0, fiscalYearStartDay: 1 };
        try {
            var configCalendar = ConfigLib.getFiscalCalendar();
            if (configCalendar) {
                fiscalCalendar = configCalendar;
            }
        } catch (e) {
            log.debug('Could not get fiscal calendar from ConfigLib', { error: e.message });
        }
        
        // Calculate fiscal year dates from config settings
        var fyStartMonth = fiscalCalendar.fiscalYearStartMonth || 0; // 0-11
        var fyStartDay = fiscalCalendar.fiscalYearStartDay || 1;
        
        // Determine which fiscal year we're in
        var fyYear = now.getFullYear();
        if (now.getMonth() < fyStartMonth || (now.getMonth() === fyStartMonth && now.getDate() < fyStartDay)) {
            fyYear = fyYear - 1; // We're still in last fiscal year
        }
        
        // Build fiscal year start/end dates
        var fyStart = new Date(fyYear, fyStartMonth, fyStartDay);
        var fyEnd = new Date(fyYear + 1, fyStartMonth, fyStartDay - 1);
        
        // Prior fiscal year dates
        var priorFyStart = new Date(fyYear - 1, fyStartMonth, fyStartDay);
        var priorFyEnd = new Date(fyYear, fyStartMonth, fyStartDay - 1);
        
        // Same date in prior year (for YoY comparisons)
        var priorYearSameDate = new Date(now);
        priorYearSameDate.setFullYear(priorYearSameDate.getFullYear() - 1);
        
        // Relative dates for convenience
        var monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        var quarterMonth = Math.floor(now.getMonth() / 3) * 3;
        var quarterStart = new Date(now.getFullYear(), quarterMonth, 1);
        var last30Days = new Date(now);
        last30Days.setDate(last30Days.getDate() - 30);
        var last90Days = new Date(now);
        last90Days.setDate(last90Days.getDate() - 90);
        var last365Days = new Date(now);
        last365Days.setDate(last365Days.getDate() - 365);
        
        // Prior quarter dates
        var priorQuarterEnd = new Date(now.getFullYear(), quarterMonth, 0);
        var priorQuarterMonth = quarterMonth - 3;
        var priorQuarterYear = now.getFullYear();
        if (priorQuarterMonth < 0) {
            priorQuarterMonth += 12;
            priorQuarterYear -= 1;
        }
        var priorQuarterStart = new Date(priorQuarterYear, priorQuarterMonth, 1);
        
        var fiscal = {
            // Current date info
            currentDate: Utils.formatDateYMD(now),
            currentYear: now.getFullYear(),
            currentMonth: now.getMonth() + 1,
            
            // Current fiscal year
            fiscalYearStart: Utils.formatDateYMD(fyStart),
            fiscalYearEnd: Utils.formatDateYMD(fyEnd),
            fiscalYearStartMonth: fyStartMonth + 1, // 1-12 for display
            fiscalYear: fyYear,
            fiscalYearName: 'FY' + fyYear,
            
            // Prior fiscal year (for YoY comparisons)
            priorFiscalYearStart: Utils.formatDateYMD(priorFyStart),
            priorFiscalYearEnd: Utils.formatDateYMD(priorFyEnd),
            priorFiscalYear: fyYear - 1,
            priorFiscalYearName: 'FY' + (fyYear - 1),
            
            // Same date comparison (YoY point-in-time)
            priorYearSameDate: Utils.formatDateYMD(priorYearSameDate),
            
            // Relative date ranges
            monthStart: Utils.formatDateYMD(monthStart),
            quarterStart: Utils.formatDateYMD(quarterStart),
            last30Days: Utils.formatDateYMD(last30Days),
            last90Days: Utils.formatDateYMD(last90Days),
            last365Days: Utils.formatDateYMD(last365Days),
            
            // Prior quarter
            priorQuarterStart: Utils.formatDateYMD(priorQuarterStart),
            priorQuarterEnd: Utils.formatDateYMD(priorQuarterEnd),
            
            currentPeriod: null
        };
        
        // Try to get current period name from database
        try {
            var periodQuery = "\n                SELECT periodname\n                FROM accountingperiod\n                WHERE startdate <= CURRENT_DATE\n                    AND enddate >= CURRENT_DATE\n                    AND isyear = 'F'\n                    AND isadjust = 'F'\n                FETCH FIRST 1 ROWS ONLY\n            ";
            var result = QueryExecutor.executeQuery(periodQuery);
            if (result.success && result.rows && result.rows.length > 0) {
                fiscal.currentPeriod = result.rows[0].periodname;
            }
        } catch (e) {
            log.debug('Could not query current period', { error: e.message });
        }
        
        log.debug('Fiscal Context', fiscal);
        return fiscal;
    }
    
    // NOTE: formatDateYMD removed - use Utils.formatDateYMD
    
    /**
     * Get period name (e.g., "Nov 2024") - not used in original but keeping for compatibility
     */
    function getPeriodName(date) {
        var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        return months[date.getMonth()] + ' ' + date.getFullYear();
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // PUBLIC API - EXPORTS
    // ═══════════════════════════════════════════════════════════════════════════════

    return {
        // Main entry point
        processChat: processChat,
        
        // Fiscal context
        getFiscalContext: getFiscalContext,
        
        // AI Providers (re-exported for backward compatibility)
        callAI: AIProviders.callAI,
        getAIConfig: AIProviders.getAIConfig,
        getCurrentModelInfo: AIProviders.getCurrentModelInfo,
        getUsage: AIProviders.getUsage,
        
        // Entity resolution (re-exported)
        resolveEntity: EntityResolver.resolveEntity,
        resolveEntityWithFallback: EntityResolver.resolveEntityWithFallback,
        
        // Response building (re-exported)
        buildResponse: ResponseBuilder.buildResponse,
        
        // Planning (re-exported)
        planExecution: Planning.planExecution,
        prepareConversationHistory: Planning.prepareConversationHistory,
        updateSessionContext: Planning.updateSessionContext,
        
        // Query execution (re-exported)
        executeTemplate: QueryExecution.executeTemplate,
        buildQueryFromTemplate: QueryExecution.buildQueryFromTemplate,
        
        // Dashboard handling (re-exported)
        handleDashboardQuery: DashboardHandler.handleDashboardQuery,
        
        // Utilities (re-exported)
        cleanQuery: Utils.cleanQuery,
        extractJsonFromText: Utils.extractJsonFromText,
        checkGovernance: Utils.checkGovernance
    };
});