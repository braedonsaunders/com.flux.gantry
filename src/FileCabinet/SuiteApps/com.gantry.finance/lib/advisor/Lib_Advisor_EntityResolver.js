/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 *
 * Lib_Advisor_EntityResolver.js
 * Hybrid Entity Resolution Engine for the Advisor module
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * V2 ARCHITECTURE NOTE:
 * This module is still actively used in the v2 architecture, but with a key
 * difference: the LLM now decides WHEN to resolve entities via the
 * `resolve_entity` tool (Lib_Advisor_Tools.js), rather than automatically
 * running entity extraction on every message.
 *
 * Old flow (v1): Message → Regex extraction → Auto-resolve all → Planner
 * New flow (v2): Message → LLM Agent → LLM decides if resolution needed → Tool call
 *
 * This eliminates the catastrophic failures where regex misidentified entities
 * (e.g., "Drill down" → "Drill Press" inventory item).
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Architecture:
 * - Layer 1: Coreference Resolution (pronouns, demonstratives) - instant, no DB
 * - Layer 2: Pattern Extraction (detect entity mentions) - instant, no DB
 * - Layer 3: Multi-Strategy DB Resolution (exact, prefix, fuzzy) - 1-2 queries
 * - Layer 4: LLM Fallback (disambiguation) - only when ambiguous
 *
 * Design Principles:
 * - Zero configuration - works in any NetSuite instance
 * - LLM only as smart fallback for truly ambiguous cases
 * - No caching (stateless per request - NetSuite limitation)
 * - No hardcoded aliases (dynamically learns from data)
 *
 * Recency Tracking:
 * - Uses entityOrder[] array to track order of entity mentions
 * - Most recent entity = entityOrder[entityOrder.length - 1]
 * - Single source of truth for pronoun resolution ("them", "it", etc.)
 */
define([
    'N/log',
    './Lib_Advisor_QueryExecutor',
    './Lib_Advisor_AIProviders'
], function(log, QueryExecutor, AIProviders) {
    'use strict';

    // ═══════════════════════════════════════════════════════════════════════════
    // SESSION CONTEXT HELPERS
    // Unified functions for managing resolved entities with proper recency tracking
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Normalize entity key for consistent storage/lookup
     * Converts "Birla Carbon Canada Ltd" → "birla_carbon_canada_ltd"
     */
    function normalizeEntityKey(term) {
        if (!term) return '';
        return term.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    }

    /**
     * Record a resolved entity in session context with proper recency tracking
     * This is THE ONLY function that should add entities to sessionContext
     * 
     * @param {object} sessionContext - Session context to modify
     * @param {string} term - Original term used to find entity (e.g., "oracle", "them")
     * @param {object} entity - Entity object with id, name, type
     */
    function recordResolvedEntity(sessionContext, term, entity) {
        if (!sessionContext || !entity || !entity.id) return;
        
        // Initialize structures if needed
        sessionContext.resolvedEntities = sessionContext.resolvedEntities || {};
        sessionContext.entityOrder = sessionContext.entityOrder || [];
        
        const key = normalizeEntityKey(entity.name);
        
        // Add/update entity in dictionary (for fast lookup)
        sessionContext.resolvedEntities[key] = {
            id: entity.id,
            name: entity.name,
            type: entity.type || entity.entity_type
        };
        
        // Also store with original term as key for direct lookups
        // BUT: DO NOT cache pronouns or coreference terms!
        // These need to be re-resolved each time based on current entityOrder
        const termKey = normalizeEntityKey(term);
        const isPronounOrCoreference = /(^|_)(them|they|their|it|its|him|her|this|that)$/i.test(termKey);
        
        if (termKey && termKey !== key && !isPronounOrCoreference) {
            sessionContext.resolvedEntities[termKey] = sessionContext.resolvedEntities[key];
        }
        
        // Update order: remove if exists, add at end (makes it most recent)
        const idx = sessionContext.entityOrder.indexOf(key);
        if (idx >= 0) {
            sessionContext.entityOrder.splice(idx, 1);
        }
        sessionContext.entityOrder.push(key);
        
        // Keep order array bounded (last 20 entities is plenty)
        if (sessionContext.entityOrder.length > 20) {
            sessionContext.entityOrder.shift();
        }
    }

    /**
     * Get the most recently mentioned entity from context
     * Uses entityOrder array to determine true recency
     * 
     * @param {object} ctx - Session context
     * @returns {object|null} Most recent entity or null
     */
    function getMostRecentEntity(ctx) {
        if (!ctx) return null;
        
        const order = ctx.entityOrder || [];
        const entities = ctx.resolvedEntities || {};
        
        // Walk backwards through order to find most recent valid entity
        for (let i = order.length - 1; i >= 0; i--) {
            const entity = entities[order[i]];
            if (entity && entity.id) {
                return entity;
            }
        }
        
        // Fallback: return any entity from dictionary
        const values = Object.values(entities);
        return values.length > 0 ? values[0] : null;
    }
    
    /**
     * Get most recent entity of a specific type
     * 
     * @param {object} ctx - Session context
     * @param {string} type - Entity type to find ('vendor', 'customer', etc.)
     * @returns {object|null} Most recent entity of that type or null
     */
    function getMostRecentEntityOfType(ctx, type) {
        if (!ctx || !type) return null;
        
        const order = ctx.entityOrder || [];
        const entities = ctx.resolvedEntities || {};
        
        // Walk backwards through order to find most recent of this type
        for (let i = order.length - 1; i >= 0; i--) {
            const entity = entities[order[i]];
            if (entity && entity.id && entity.type === type) {
                return entity;
            }
        }
        
        return null;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // LAYER 1: COREFERENCE RESOLUTION
    // Handles pronouns, demonstratives, and anaphoric references
    // Cost: <1ms, Confidence: 1.0 when applicable
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Coreference patterns - order matters (more specific first)
     * All patterns use getMostRecentEntity() which reads from entityOrder[]
     */
    const COREFERENCE_PATTERNS = [
        // ═══════════════════════════════════════════════════════════════════════════
        // HIGHEST PRIORITY: Noun + preposition + pronoun patterns
        // These use context clues from the noun to infer the expected entity type
        // e.g., "invoices from them" → Customer, "bills from them" → Vendor
        // ═══════════════════════════════════════════════════════════════════════════
        {
            regex: /\b(invoices?|bills?|payments?|orders?|transactions?|purchase\s*orders?|pos?|sales?\s*orders?|sos?|receipts?|credits?|debits?)\s+(from|to|for|with)\s+(them|it)\b/gi,
            condition: (ctx) => {
                const entities = Object.values(ctx.resolvedEntities || {});
                return entities.length >= 1;
            },
            resolve: (ctx, match) => {
                const noun = match[1].toLowerCase();
                const prep = match[2].toLowerCase();
                
                // Determine expected entity type based on noun + preposition context
                let expectedType = null;
                
                // Bills are always FROM vendors
                if (noun.includes('bill')) {
                    expectedType = 'vendor';
                }
                // Purchase orders / POs are always TO vendors
                else if (noun.includes('purchase') || noun === 'po' || noun === 'pos') {
                    expectedType = 'vendor';
                }
                // Sales orders / SOs are always FROM customers
                else if (noun.includes('sales') || noun === 'so' || noun === 'sos') {
                    expectedType = 'customer';
                }
                // Invoices: You send invoices TO customers, receive invoices FROM customers
                // "invoice" typically means AR (Customer Invoice), not AP (Vendor Bill)
                // So all invoice references should prefer customer
                else if (noun.includes('invoice')) {
                    expectedType = 'customer';
                }
                // Orders: FROM customer (sales) or TO vendor (purchase)
                else if (noun.includes('order')) {
                    expectedType = (prep === 'from') ? 'customer' : 'vendor';
                }
                // Payments: TO vendor or FROM customer
                else if (noun.includes('payment')) {
                    expectedType = (prep === 'to' || prep === 'for') ? 'vendor' : 'customer';
                }
                // Receipts: typically FROM vendors or TO customers
                else if (noun.includes('receipt')) {
                    expectedType = (prep === 'from') ? 'vendor' : 'customer';
                }
                
                // Try to find an entity of the expected type first
                if (expectedType) {
                    const typedEntity = getMostRecentEntityOfType(ctx, expectedType);
                    if (typedEntity) {
                        return typedEntity;
                    }
                }
                
                // Fall back to most recent entity of any type
                return getMostRecentEntity(ctx);
            }
        },
        // Possessive pronouns with entity type hint
        {
            regex: /\b(their|its)\s+(invoices?|bills?|orders?|transactions?|payments?|purchase\s*orders?)\b/gi,
            resolve: (ctx, match) => {
                // Prefer vendor for bills, customer for invoices
                const typeHint = match[2].toLowerCase().includes('bill') ? 'vendor' : 'customer';
                // First try type-specific, then fall back to most recent
                return getMostRecentEntityOfType(ctx, typeHint) || getMostRecentEntity(ctx);
            }
        },
        // Demonstrative + type: "that vendor", "this customer"
        {
            regex: /\b(that|this|the)\s+(vendor|customer|employee|item|project|company|supplier|client)\b/gi,
            resolve: (ctx, match) => {
                const typeMap = {
                    'vendor': 'vendor', 'supplier': 'vendor',
                    'customer': 'customer', 'client': 'customer',
                    'employee': 'employee',
                    'item': 'item', 'product': 'item',
                    'project': 'project', 'job': 'project',
                    'company': null // Could be vendor or customer
                };
                const targetType = typeMap[match[2].toLowerCase()];
                if (targetType) {
                    return getMostRecentEntityOfType(ctx, targetType);
                }
                return getMostRecentEntity(ctx); // Fallback to most recent
            }
        },
        // "Same" references: "the same vendor", "same customer"
        {
            regex: /\b(the\s+)?same\s+(vendor|customer|company|entity|one)\b/gi,
            resolve: (ctx) => {
                return getMostRecentEntity(ctx); // Explicitly most recent
            }
        },
        // Simple pronouns - require exactly 1 entity in context
        {
            regex: /\b(them|they|their|theirs|it|its)\b/gi,
            condition: (ctx) => {
                const entities = Object.values(ctx.resolvedEntities || {});
                return entities.length === 1;
            },
            resolve: (ctx) => getMostRecentEntity(ctx)
        },
        // "From them", "to them", "for them" - more contextual pronouns
        // This is the KEY pattern for "get invoices to them"
        {
            regex: /\b(from|to|for|with|by)\s+(them|it)\b/gi,
            condition: (ctx) => {
                const entities = Object.values(ctx.resolvedEntities || {});
                return entities.length >= 1;
            },
            resolve: (ctx) => {
                // CRITICAL: Use most recently mentioned entity, not arbitrary first
                return getMostRecentEntity(ctx);
            }
        }
    ];

    /**
     * Resolve coreferences (pronouns, demonstratives) using session context
     * @param {string} message - User message
     * @param {object} sessionContext - Session context with resolvedEntities
     * @returns {object} { message: enrichedMessage, resolved: [...], log: [...] }
     */
    function resolveCoreferences(message, sessionContext) {
        const debugLog = [];
        let enrichedMessage = message;
        const resolved = [];
        
        const entities = Object.values(sessionContext?.resolvedEntities || {});
        debugLog.push({ layer: 1, action: 'start', entitiesInContext: entities.length, entities: entities.map(e => e.name) });
        
        if (entities.length === 0) {
            debugLog.push({ layer: 1, action: 'skip', reason: 'no entities in context' });
            return { message: enrichedMessage, resolved, log: debugLog };
        }

        for (const pattern of COREFERENCE_PATTERNS) {
            // Check condition if exists
            if (pattern.condition && !pattern.condition(sessionContext)) {
                continue;
            }
            
            // Find all matches
            let match;
            const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
            
            while ((match = regex.exec(enrichedMessage)) !== null) {
                const entity = pattern.resolve(sessionContext, match);
                
                if (entity) {
                    const originalText = match[0];
                    const marker = `[[${(entity.type || 'entity').toUpperCase()}:${entity.id}:${entity.name}]]`;
                    
                    // Replace in message
                    enrichedMessage = enrichedMessage.slice(0, match.index) + 
                                     marker + 
                                     enrichedMessage.slice(match.index + originalText.length);
                    
                    resolved.push({
                        original: originalText,
                        entity: entity,
                        confidence: 1.0,
                        strategy: 'coreference'
                    });
                    
                    debugLog.push({
                        layer: 1,
                        action: 'resolved',
                        original: originalText,
                        resolvedTo: entity.name,
                        entityId: entity.id
                    });
                    
                    // Reset regex to continue from start (message changed)
                    regex.lastIndex = 0;
                    break; // Restart outer loop to handle overlapping patterns
                }
            }
        }
        
        debugLog.push({ layer: 1, action: 'complete', resolvedCount: resolved.length });
        return { message: enrichedMessage, resolved, log: debugLog };
    }


    // ═══════════════════════════════════════════════════════════════════════════
    // LAYER 2: PATTERN EXTRACTION
    // Detects potential entity mentions without resolving them
    // Cost: <1ms, Output: List of unresolved mentions
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Common words to skip when detecting entities
     */
    const SKIP_WORDS = new Set([
        'last year', 'this year', 'next year', 'year to date', 'ytd',
        'last month', 'this month', 'next month', 'last week', 'this week',
        'net income', 'gross profit', 'total revenue', 'cash flow',
        'balance sheet', 'income statement', 'profit and loss',
        'accounts payable', 'accounts receivable', 'general ledger',
        'fiscal year', 'calendar year', 'quarter', 'period',
        'january', 'february', 'march', 'april', 'may', 'june',
        'july', 'august', 'september', 'october', 'november', 'december',
        'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
        'the', 'and', 'for', 'from', 'with', 'all', 'get', 'show', 'find', 'list'
    ]);

    /**
     * Extract potential entity mentions from message
     * @param {string} message - Message (may have some entities already resolved as [[TYPE:ID:NAME]])
     * @returns {array} Array of { mention, type, confidence, span }
     */
    function extractEntityMentions(message) {
        const mentions = [];
        
        // Skip already-resolved markers
        const resolvedPattern = /\[\[(\w+):(\d+):([^\]]+)\]\]/g;
        const cleanMessage = message.replace(resolvedPattern, ' __RESOLVED__ ');
        
        // 1. Transaction IDs - direct resolution possible
        const txnPatterns = [
            { regex: /\b(INV|SO|PO|BILL|RMA|WO|TO|JE|CHECK)[-#]?\s*(\d{4,})\b/gi, type: 'transaction' },
            { regex: /\binvoice\s*#?\s*(\d{4,})\b/gi, type: 'transaction' },
            { regex: /\bPO\s*#?\s*(\d{4,})\b/gi, type: 'transaction' },
            { regex: /\border\s*#?\s*(\d{4,})\b/gi, type: 'transaction' }
        ];
        
        for (const pattern of txnPatterns) {
            let match;
            while ((match = pattern.regex.exec(cleanMessage)) !== null) {
                mentions.push({
                    mention: match[0],
                    type: pattern.type,
                    confidence: 0.95,
                    span: [match.index, match.index + match[0].length],
                    directId: match[2] || match[1] // The numeric part
                });
            }
        }
        
        // 2. Quoted strings - high confidence mentions
        const quotedPattern = /["']([^"']{2,50})["']/g;
        let match;
        while ((match = quotedPattern.exec(cleanMessage)) !== null) {
            const mention = match[1].trim();
            if (!SKIP_WORDS.has(mention.toLowerCase())) {
                mentions.push({
                    mention: mention,
                    type: 'auto',
                    confidence: 0.9,
                    span: [match.index, match.index + match[0].length],
                    quoted: true
                });
            }
        }
        
        // 3. Type + Name patterns: "vendor Oracle", "customer Acme" (case-insensitive)
        const typeNamePattern = /\b(vendor|customer|employee|item|project|supplier|client)\s+([A-Za-z][A-Za-z0-9\s&\-\.]+?)(?=\s+(?:and|or|for|from|to|with|,|\.|$|their|its|invoices?|bills?|orders?))/gi;
        while ((match = typeNamePattern.exec(cleanMessage)) !== null) {
            const typeMap = { 'supplier': 'vendor', 'client': 'customer' };
            const entityType = typeMap[match[1].toLowerCase()] || match[1].toLowerCase();
            const mention = match[2].trim();
            
            if (!SKIP_WORDS.has(mention.toLowerCase()) && mention.length >= 2) {
                mentions.push({
                    mention: mention,
                    type: entityType,
                    confidence: 0.85,
                    span: [match.index, match.index + match[0].length]
                });
            }
        }
        
        // 4. "From/to/for X" patterns - handles BOTH capitalized and lowercase entity names
        // This is crucial for queries like "invoices from oracle" where oracle is lowercase
        const prepositionPattern = /\b(?:from|to|for|with|by)\s+([A-Za-z][A-Za-z0-9\s&\-\.]{1,40}?)(?=\s+(?:and|or|for|from|to|with|,|\.|$|this|last|in|on|at|their)|$)/gi;
        while ((match = prepositionPattern.exec(cleanMessage)) !== null) {
            const mention = match[1].trim();
            if (!SKIP_WORDS.has(mention.toLowerCase()) && mention.length >= 2) {
                // Check it's not already captured
                const alreadyCaptured = mentions.some(m => 
                    m.mention.toLowerCase() === mention.toLowerCase()
                );
                if (!alreadyCaptured) {
                    mentions.push({
                        mention: mention,
                        type: 'auto',
                        confidence: 0.7,
                        span: [match.index, match.index + match[0].length]
                    });
                }
            }
        }
        
        // 4b. End-of-sentence entity detection: "invoice from oracle" or "invoice to birla"
        // Catches entities at the very end of the message
        const endOfMessagePattern = /\b(?:from|to|for)\s+([a-zA-Z][a-zA-Z0-9]{1,30})$/gi;
        while ((match = endOfMessagePattern.exec(cleanMessage)) !== null) {
            const mention = match[1].trim();
            if (!SKIP_WORDS.has(mention.toLowerCase()) && mention.length >= 2) {
                const alreadyCaptured = mentions.some(m => 
                    m.mention.toLowerCase() === mention.toLowerCase()
                );
                if (!alreadyCaptured) {
                    mentions.push({
                        mention: mention,
                        type: 'auto',
                        confidence: 0.75, // Higher confidence for end-of-message position
                        span: [match.index, match.index + match[0].length]
                    });
                }
            }
        }
        
        // 5. Multi-word capitalized sequences (potential company names)
        // More restrictive to avoid false positives
        const capsPattern = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,4})\b/g;
        while ((match = capsPattern.exec(cleanMessage)) !== null) {
            const mention = match[1].trim();
            if (!SKIP_WORDS.has(mention.toLowerCase()) && 
                mention.length >= 4 &&
                !mentions.some(m => m.mention.toLowerCase() === mention.toLowerCase())) {
                mentions.push({
                    mention: mention,
                    type: 'auto',
                    confidence: 0.5, // Lower confidence for just capitalization
                    span: [match.index, match.index + match[0].length]
                });
            }
        }
        
        // Sort by confidence (highest first) and position
        mentions.sort((a, b) => b.confidence - a.confidence || a.span[0] - b.span[0]);
        
        // Remove duplicates and overlaps
        const filtered = [];
        for (const mention of mentions) {
            const overlaps = filtered.some(f => 
                (mention.span[0] >= f.span[0] && mention.span[0] < f.span[1]) ||
                (mention.span[1] > f.span[0] && mention.span[1] <= f.span[1])
            );
            const duplicate = filtered.some(f => 
                f.mention.toLowerCase() === mention.mention.toLowerCase()
            );
            if (!overlaps && !duplicate) {
                filtered.push(mention);
            }
        }
        
        return filtered;
    }


    // ═══════════════════════════════════════════════════════════════════════════
    // LAYER 3: MULTI-STRATEGY DATABASE RESOLUTION
    // Exact → Prefix → Contains → Word Match → Fuzzy
    // Cost: 10-50ms per entity, single combined query when possible
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Entity type to table mapping with field names
     */
    const ENTITY_CONFIG = {
        customer: { table: 'customer', nameField: 'companyname', codeField: 'entityid' },
        vendor: { table: 'vendor', nameField: 'companyname', codeField: 'entityid' },
        employee: { table: 'employee', nameField: 'entityid', codeField: 'email' },
        department: { table: 'department', nameField: 'name', codeField: 'name' },
        item: { table: 'item', nameField: 'itemid', codeField: 'displayname' },
        project: { table: 'job', nameField: 'companyname', codeField: 'entityid' },
        account: { table: 'account', nameField: 'accountsearchdisplayname', codeField: 'acctnumber' }
    };

    /**
     * Escape SQL string to prevent injection
     */
    function escapeSql(str) {
        if (!str) return '';
        return String(str).replace(/'/g, "''");
    }

    /**
     * Build a multi-strategy search query for an entity
     * Returns candidates with match scores
     */
    function buildResolutionQuery(mention, entityType) {
        const termSafe = escapeSql(mention);
        const termLower = termSafe.toLowerCase();
        
        // Determine which tables to search
        const types = entityType === 'auto' 
            ? ['vendor', 'customer', 'employee', 'item', 'project']
            : [entityType];
        
        const unions = types.map(type => {
            const config = ENTITY_CONFIG[type];
            if (!config) return null;
            
            return `
                SELECT 
                    '${type}' AS entity_type,
                    id,
                    ${config.nameField} AS name,
                    ${config.codeField} AS code,
                    CASE 
                        WHEN LOWER(${config.nameField}) = LOWER('${termSafe}') THEN 1.00
                        WHEN LOWER(${config.codeField}) = LOWER('${termSafe}') THEN 0.98
                        WHEN LOWER(${config.nameField}) LIKE LOWER('${termSafe}') || '%' THEN 0.90
                        WHEN LOWER(${config.codeField}) LIKE LOWER('${termSafe}') || '%' THEN 0.88
                        WHEN LOWER(${config.nameField}) LIKE '% ' || LOWER('${termSafe}') || '%' THEN 0.82
                        WHEN LOWER(${config.nameField}) LIKE '%' || LOWER('${termSafe}') || '%' THEN 0.75
                        WHEN LOWER(${config.codeField}) LIKE '%' || LOWER('${termSafe}') || '%' THEN 0.70
                        ELSE 0.50
                    END AS match_score,
                    CASE 
                        WHEN LOWER(${config.nameField}) = LOWER('${termSafe}') THEN 'exact'
                        WHEN LOWER(${config.codeField}) = LOWER('${termSafe}') THEN 'exact_code'
                        WHEN LOWER(${config.nameField}) LIKE LOWER('${termSafe}') || '%' THEN 'prefix'
                        WHEN LOWER(${config.codeField}) LIKE LOWER('${termSafe}') || '%' THEN 'prefix_code'
                        WHEN LOWER(${config.nameField}) LIKE '% ' || LOWER('${termSafe}') || '%' THEN 'word_start'
                        WHEN LOWER(${config.nameField}) LIKE '%' || LOWER('${termSafe}') || '%' THEN 'contains'
                        WHEN LOWER(${config.codeField}) LIKE '%' || LOWER('${termSafe}') || '%' THEN 'contains_code'
                        ELSE 'fuzzy'
                    END AS match_type
                FROM ${config.table}
                WHERE isinactive = 'F'
                  AND (
                      LOWER(${config.nameField}) LIKE '%' || LOWER('${termSafe}') || '%'
                      OR LOWER(${config.codeField}) LIKE '%' || LOWER('${termSafe}') || '%'
                  )
            `;
        }).filter(Boolean);
        
        if (unions.length === 0) return null;
        
        return `
            SELECT * FROM (${unions.join(' UNION ALL ')})
            ORDER BY match_score DESC
            FETCH FIRST 10 ROWS ONLY
        `;
    }

    /**
     * Build query for word-based matching
     * Matches individual words from the search term
     */
    function buildWordMatchQuery(mention, entityType) {
        const words = mention.split(/[\s\-_.&,]+/).filter(w => w.length >= 2);
        if (words.length < 2) return null;
        
        const types = entityType === 'auto' 
            ? ['vendor', 'customer']  // Limit to most common for word match
            : [entityType];
        
        const unions = types.map(type => {
            const config = ENTITY_CONFIG[type];
            if (!config) return null;
            
            const wordConditions = words.map(w => 
                `LOWER(${config.nameField}) LIKE '%${escapeSql(w.toLowerCase())}%'`
            ).join(' AND ');
            
            return `
                SELECT 
                    '${type}' AS entity_type,
                    id,
                    ${config.nameField} AS name,
                    ${config.codeField} AS code,
                    0.80 AS match_score,
                    'word_match' AS match_type
                FROM ${config.table}
                WHERE isinactive = 'F'
                  AND (${wordConditions})
            `;
        }).filter(Boolean);
        
        if (unions.length === 0) return null;
        
        return `
            SELECT * FROM (${unions.join(' UNION ALL ')})
            ORDER BY name
            FETCH FIRST 5 ROWS ONLY
        `;
    }

    /**
     * Calculate Levenshtein distance for fuzzy matching
     */
    function levenshteinDistance(a, b) {
        if (a.length === 0) return b.length;
        if (b.length === 0) return a.length;
        
        const matrix = [];
        for (let i = 0; i <= b.length; i++) {
            matrix[i] = [i];
        }
        for (let j = 0; j <= a.length; j++) {
            matrix[0][j] = j;
        }
        
        for (let i = 1; i <= b.length; i++) {
            for (let j = 1; j <= a.length; j++) {
                if (b.charAt(i - 1) === a.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + 1,
                        matrix[i][j - 1] + 1,
                        matrix[i - 1][j] + 1
                    );
                }
            }
        }
        
        return matrix[b.length][a.length];
    }

    /**
     * Score candidates based on fuzzy matching (for post-processing)
     */
    function applyFuzzyScoring(candidates, mention) {
        const mentionLower = mention.toLowerCase();
        
        return candidates.map(c => {
            const nameLower = (c.name || '').toLowerCase();
            
            // Calculate additional fuzzy score based on Levenshtein
            let fuzzyBonus = 0;
            
            // Check abbreviation match (e.g., "HD" for "Home Depot")
            const words = nameLower.split(/[\s\-_.&,]+/);
            const initials = words.map(w => w[0] || '').join('');
            if (initials === mentionLower || initials.startsWith(mentionLower)) {
                fuzzyBonus = 0.1;
            }
            
            // Levenshtein for short typos
            if (mentionLower.length >= 3 && mentionLower.length <= 10) {
                const compareStr = nameLower.substring(0, mentionLower.length + 2);
                const distance = levenshteinDistance(mentionLower, compareStr);
                if (distance <= 2) {
                    fuzzyBonus = Math.max(fuzzyBonus, 0.15 - (distance * 0.05));
                }
            }
            
            return {
                ...c,
                match_score: Math.min((c.match_score || 0.5) + fuzzyBonus, 1.0)
            };
        });
    }

    /**
     * Apply context boosting to candidates
     */
    function applyContextBoosts(candidates, sessionContext) {
        const recentEntities = sessionContext?.resolvedEntities || {};
        const recentIds = Object.values(recentEntities).map(e => e.id);
        
        return candidates.map(c => {
            let boost = 0;
            
            // Recently mentioned in session
            if (recentIds.includes(c.id)) {
                boost += 0.1;
            }
            
            // Same type as recently resolved entities
            const recentTypes = Object.values(recentEntities).map(e => e.type);
            if (recentTypes.includes(c.entity_type)) {
                boost += 0.03;
            }
            
            return {
                ...c,
                match_score: Math.min(c.match_score + boost, 1.0),
                contextBoost: boost
            };
        });
    }

    /**
     * Main database resolution function
     * @returns {object} { candidates, confidence, isAmbiguous }
     */
    function resolveFromDatabase(mention, entityType, sessionContext) {
        const debugLog = [];
        debugLog.push({ layer: 3, action: 'start', mention, entityType });
        
        // Strategy 1: Main multi-strategy query
        const mainQuery = buildResolutionQuery(mention, entityType);
        let candidates = [];
        
        if (mainQuery) {
            try {
                const result = QueryExecutor.executeQuery(mainQuery);
                if (result.success && result.rows) {
                    candidates = result.rows.map(r => ({
                        id: r.id,
                        name: r.name,
                        code: r.code,
                        entity_type: r.entity_type,
                        match_score: parseFloat(r.match_score) || 0.5,
                        match_type: r.match_type
                    }));
                    debugLog.push({ layer: 3, action: 'main_query', resultCount: candidates.length });
                }
            } catch (e) {
                log.error('DB resolution main query failed', { mention, error: e.message });
                debugLog.push({ layer: 3, action: 'main_query_error', error: e.message });
            }
        }
        
        // Strategy 2: Word match (if no good results and multi-word mention)
        if (candidates.length === 0 || (candidates[0]?.match_score || 0) < 0.8) {
            const wordQuery = buildWordMatchQuery(mention, entityType);
            if (wordQuery) {
                try {
                    const result = QueryExecutor.executeQuery(wordQuery);
                    if (result.success && result.rows && result.rows.length > 0) {
                        const wordCandidates = result.rows.map(r => ({
                            id: r.id,
                            name: r.name,
                            code: r.code,
                            entity_type: r.entity_type,
                            match_score: parseFloat(r.match_score) || 0.8,
                            match_type: r.match_type
                        }));
                        // Merge with existing, avoiding duplicates
                        for (const wc of wordCandidates) {
                            if (!candidates.some(c => c.id === wc.id && c.entity_type === wc.entity_type)) {
                                candidates.push(wc);
                            }
                        }
                        debugLog.push({ layer: 3, action: 'word_query', addedCount: wordCandidates.length });
                    }
                } catch (e) {
                    log.debug('DB resolution word query failed', { mention, error: e.message });
                }
            }
        }
        
        if (candidates.length === 0) {
            debugLog.push({ layer: 3, action: 'no_results' });
            return { candidates: [], confidence: 0, isAmbiguous: false, log: debugLog };
        }
        
        // Apply fuzzy scoring adjustments
        candidates = applyFuzzyScoring(candidates, mention);
        
        // Apply context boosting
        candidates = applyContextBoosts(candidates, sessionContext);
        
        // Sort by final score
        candidates.sort((a, b) => b.match_score - a.match_score);
        
        // Determine confidence and ambiguity
        const topScore = candidates[0].match_score;
        const secondScore = candidates[1]?.match_score || 0;
        const scoreDiff = topScore - secondScore;
        
        // Ambiguous if close scores and both above threshold
        const isAmbiguous = candidates.length > 1 && 
                           scoreDiff < 0.1 && 
                           secondScore >= 0.7;
        
        debugLog.push({
            layer: 3,
            action: 'complete',
            topCandidate: candidates[0]?.name,
            topScore,
            secondScore,
            isAmbiguous
        });
        
        return {
            candidates: candidates.slice(0, 5),
            confidence: topScore,
            isAmbiguous,
            log: debugLog
        };
    }


    // ═══════════════════════════════════════════════════════════════════════════
    // LAYER 4: LLM FALLBACK
    // Used only when database resolution is ambiguous
    // Cost: ~500ms (Tier 1 model), only for edge cases
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Use LLM to disambiguate between candidates
     * @param {string} mention - Original mention text
     * @param {array} candidates - Top candidates from DB
     * @param {object} messageContext - Current message and recent history
     * @returns {object|null} Selected entity or null if can't decide
     */
    function resolveWithLLM(mention, candidates, messageContext, config) {
        const debugLog = [];
        debugLog.push({ layer: 4, action: 'start', mention, candidateCount: candidates.length });
        
        if (!candidates || candidates.length < 2) {
            return { entity: candidates?.[0] || null, log: debugLog };
        }
        
        const candidateList = candidates.slice(0, 5).map((c, i) => 
            `${i + 1}. "${c.name}" (${c.entity_type}, ${Math.round(c.match_score * 100)}% match)`
        ).join('\n');
        
        const historyContext = messageContext.recentHistory?.length > 0
            ? `Recent conversation:\n${messageContext.recentHistory.slice(-3).map(m => `- ${m}`).join('\n')}`
            : '';
        
        const prompt = `You are an entity disambiguation assistant. The user mentioned "${mention}" in their message.

User's message: "${messageContext.currentMessage}"
${historyContext}

Database found these possible matches:
${candidateList}

Based on the context, which entity did the user most likely mean?

Return ONLY valid JSON with no explanation:
{"index": <1-based number>, "confidence": <0.0-1.0>, "reason": "<brief reason>"}`;

        try {
            const result = AIProviders.callAI(prompt, {
                tier: 1,
                purpose: 'Entity disambiguation',
                jsonMode: true,
                maxTokens: 100
            });
            
            let parsed;
            try {
                // Handle potential markdown wrapping
                let text = result.text || '';
                text = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
                parsed = JSON.parse(text);
            } catch (parseError) {
                debugLog.push({ layer: 4, action: 'parse_error', error: parseError.message });
                return { entity: candidates[0], usedLLM: true, llmFailed: true, log: debugLog };
            }
            
            const index = parseInt(parsed.index, 10);
            if (index >= 1 && index <= candidates.length) {
                const selected = candidates[index - 1];
                debugLog.push({
                    layer: 4,
                    action: 'selected',
                    selected: selected.name,
                    reason: parsed.reason,
                    llmConfidence: parsed.confidence
                });
                return { 
                    entity: selected, 
                    usedLLM: true, 
                    llmReason: parsed.reason,
                    log: debugLog 
                };
            }
            
            debugLog.push({ layer: 4, action: 'invalid_index', index });
            return { entity: candidates[0], usedLLM: true, llmFailed: true, log: debugLog };
            
        } catch (e) {
            log.error('LLM disambiguation failed', { mention, error: e.message });
            debugLog.push({ layer: 4, action: 'llm_error', error: e.message });
            // Fallback to top candidate
            return { entity: candidates[0], usedLLM: true, llmFailed: true, log: debugLog };
        }
    }


    // ═══════════════════════════════════════════════════════════════════════════
    // MAIN INTEGRATION: PRE-PLANNER ENTITY RESOLUTION
    // Processes message BEFORE it reaches the planner
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Escape special regex characters
     */
    function escapeRegex(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    /**
     * Main entry point: Resolve all entities in a message before planning
     * @param {string} message - User message
     * @param {object} sessionContext - Session context with resolvedEntities
     * @param {object} config - Optional config (provider settings, etc.)
     * @returns {object} { enrichedMessage, resolvedEntities, sessionContext, debugLog }
     */
    function resolveEntitiesInMessage(message, sessionContext, config) {
        const startTime = Date.now();
        const masterLog = [];
        const newlyResolved = [];
        
        // Initialize session context if needed, preserving existing entityOrder
        sessionContext = sessionContext || {};
        sessionContext.resolvedEntities = sessionContext.resolvedEntities || {};
        sessionContext.entityOrder = sessionContext.entityOrder || [];
        
        // ═══════════════════════════════════════════════════════════════════
        // CLEANUP: Remove any cached pronoun/coreference entries from resolvedEntities
        // These should NOT be cached because they need to be re-resolved each time
        // based on the current entityOrder context
        // ═══════════════════════════════════════════════════════════════════
        const pronounPattern = /(^|_)(them|they|their|it|its|him|her|this|that)$/i;
        const keysToRemove = Object.keys(sessionContext.resolvedEntities).filter(key => pronounPattern.test(key));
        if (keysToRemove.length > 0) {
            keysToRemove.forEach(key => delete sessionContext.resolvedEntities[key]);
            masterLog.push({
                phase: 'cleanup',
                action: 'removed_cached_pronouns',
                removed: keysToRemove
            });
        }
        
        masterLog.push({ 
            phase: 'start', 
            originalMessage: message,
            existingEntities: Object.keys(sessionContext.resolvedEntities),
            existingEntityOrder: sessionContext.entityOrder.slice()  // Log for debugging
        });
        
        // ═══════════════════════════════════════════════════════════════════
        // LAYER 1: Coreference Resolution
        // ═══════════════════════════════════════════════════════════════════
        const corefResult = resolveCoreferences(message, sessionContext);
        let enrichedMessage = corefResult.message;
        masterLog.push(...corefResult.log);
        
        for (const r of corefResult.resolved) {
            newlyResolved.push(r);
            // Record with recency tracking (coreference brings entity to "most recent")
            if (r.entity && r.entity.id) {
                recordResolvedEntity(sessionContext, r.original, r.entity);
            }
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // LAYER 2: Pattern Extraction
        // ═══════════════════════════════════════════════════════════════════
        const mentions = extractEntityMentions(enrichedMessage);
        masterLog.push({ 
            layer: 2, 
            action: 'extracted', 
            mentionCount: mentions.length,
            mentions: mentions.map(m => ({ mention: m.mention, type: m.type, confidence: m.confidence }))
        });
        
        // ═══════════════════════════════════════════════════════════════════
        // LAYER 3 & 4: Resolve each mention
        // ═══════════════════════════════════════════════════════════════════
        for (const mention of mentions) {
            // Skip if already resolved by coreference
            const alreadyResolved = newlyResolved.some(r => 
                r.entity.name.toLowerCase().includes(mention.mention.toLowerCase()) ||
                mention.mention.toLowerCase().includes(r.entity.name.toLowerCase())
            );
            if (alreadyResolved) {
                masterLog.push({ layer: 3, action: 'skip_already_resolved', mention: mention.mention });
                continue;
            }
            
            // Check if already in session context with exact match
            const existingEntity = Object.values(sessionContext.resolvedEntities || {}).find(e =>
                e.name.toLowerCase() === mention.mention.toLowerCase()
            );
            if (existingEntity) {
                // Entity exists in context - still update entityOrder to make it "most recent"
                // This is critical for pronoun resolution in follow-up messages
                recordResolvedEntity(sessionContext, mention.mention, existingEntity);
                masterLog.push({ 
                    layer: 3, 
                    action: 'recency_update_existing', 
                    mention: mention.mention,
                    entity: existingEntity.name
                });
                continue;
            }
            
            // Layer 3: Database resolution
            const dbResult = resolveFromDatabase(mention.mention, mention.type, sessionContext);
            masterLog.push(...(dbResult.log || []));
            
            let selectedEntity = null;
            let usedLLM = false;
            
            if (dbResult.confidence >= 0.85 && !dbResult.isAmbiguous) {
                // High confidence - use directly
                selectedEntity = dbResult.candidates[0];
                masterLog.push({ 
                    layer: 3, 
                    action: 'high_confidence_select',
                    mention: mention.mention,
                    selected: selectedEntity.name,
                    score: dbResult.confidence
                });
                
            } else if (dbResult.candidates.length > 0 && dbResult.isAmbiguous) {
                // Ambiguous - use LLM
                const llmResult = resolveWithLLM(
                    mention.mention,
                    dbResult.candidates,
                    {
                        currentMessage: message,
                        recentHistory: sessionContext.messageHistory?.slice(-3) || []
                    },
                    config
                );
                masterLog.push(...(llmResult.log || []));
                
                if (llmResult.entity) {
                    selectedEntity = llmResult.entity;
                    usedLLM = true;
                }
                
            } else if (dbResult.candidates.length > 0) {
                // Medium confidence - use top result but flag
                selectedEntity = dbResult.candidates[0];
                masterLog.push({ 
                    layer: 3, 
                    action: 'medium_confidence_select',
                    mention: mention.mention,
                    selected: selectedEntity.name,
                    score: dbResult.confidence
                });
            }
            
            // If we resolved an entity, mark it in the message
            if (selectedEntity) {
                const marker = `[[${(selectedEntity.entity_type || 'entity').toUpperCase()}:${selectedEntity.id}:${selectedEntity.name}]]`;
                enrichedMessage = enrichedMessage.replace(
                    new RegExp(escapeRegex(mention.mention), 'gi'),
                    marker
                );
                
                newlyResolved.push({
                    original: mention.mention,
                    entity: {
                        id: selectedEntity.id,
                        name: selectedEntity.name,
                        type: selectedEntity.entity_type,
                        code: selectedEntity.code
                    },
                    confidence: selectedEntity.match_score,
                    strategy: usedLLM ? 'llm_disambiguation' : 'database',
                    matchType: selectedEntity.match_type
                });
                
                // Record entity with proper recency tracking
                recordResolvedEntity(sessionContext, mention.mention, {
                    id: selectedEntity.id,
                    name: selectedEntity.name,
                    type: selectedEntity.entity_type
                });
            } else {
                masterLog.push({ 
                    layer: 3, 
                    action: 'unresolved',
                    mention: mention.mention,
                    candidateCount: dbResult.candidates.length
                });
            }
        }
        
        const duration = Date.now() - startTime;
        masterLog.push({ 
            phase: 'complete', 
            duration,
            resolvedCount: newlyResolved.length,
            enrichedMessage: enrichedMessage.substring(0, 200)
        });
        
        return {
            enrichedMessage,
            originalMessage: message,
            resolvedEntities: newlyResolved,
            sessionContext,
            debugLog: masterLog
        };
    }


    // ═══════════════════════════════════════════════════════════════════════════
    // LEGACY COMPATIBILITY
    // These functions maintain backward compatibility with existing code
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Legacy: Resolve entity with fallback (for direct calls)
     */
    function resolveEntityWithFallback(userTerm, entityType, preferredType) {
        // Use synchronous version for legacy compatibility
        return resolveEntitySync(userTerm, entityType || 'auto', preferredType);
    }

    /**
     * Synchronous entity resolution (for legacy code)
     */
    function resolveEntitySync(userTerm, entityType, preferredType) {
        if (!userTerm || typeof userTerm !== 'string') {
            return { success: false, error: 'Missing or invalid userTerm' };
        }
        
        const term = userTerm.trim();
        const type = entityType || 'auto';
        
        // Determine search order
        let typesToSearch = type === 'auto' 
            ? ['customer', 'vendor', 'employee', 'item', 'project']
            : [type];
        
        // Put preferred type first
        if (preferredType && typesToSearch.includes(preferredType)) {
            typesToSearch = [preferredType, ...typesToSearch.filter(t => t !== preferredType)];
        }
        
        const allCandidates = [];
        
        for (const searchType of typesToSearch) {
            const config = ENTITY_CONFIG[searchType];
            if (!config) continue;
            
            const termSafe = escapeSql(term);
            const query = `
                SELECT 
                    id, 
                    ${config.nameField} AS name, 
                    ${config.codeField} AS code,
                    CASE 
                        WHEN LOWER(${config.nameField}) = LOWER('${termSafe}') THEN 1.00
                        WHEN LOWER(${config.nameField}) LIKE LOWER('${termSafe}') || '%' THEN 0.90
                        WHEN LOWER(${config.nameField}) LIKE '%' || LOWER('${termSafe}') || '%' THEN 0.75
                        ELSE 0.50
                    END AS match_score
                FROM ${config.table}
                WHERE isinactive = 'F'
                  AND (LOWER(${config.nameField}) LIKE '%' || LOWER('${termSafe}') || '%'
                       OR LOWER(${config.codeField}) LIKE '%' || LOWER('${termSafe}') || '%')
                ORDER BY match_score DESC
                FETCH FIRST 10 ROWS ONLY
            `;
            
            try {
                const result = QueryExecutor.executeQuery(query);
                if (result.success && result.rows && result.rows.length > 0) {
                    for (const row of result.rows) {
                        allCandidates.push({
                            id: row.id,
                            name: row.name,
                            code: row.code,
                            type: searchType,
                            score: parseFloat(row.match_score) || 0.5,
                            isPreferredType: searchType === preferredType
                        });
                    }
                }
            } catch (e) {
                log.debug('Entity search failed', { type: searchType, error: e.message });
            }
        }
        
        if (allCandidates.length === 0) {
            return {
                success: true,
                notFound: true,
                message: `No entity found matching "${userTerm}"`,
                confidence: 'none'
            };
        }
        
        // Sort by score (with preferred type bonus)
        allCandidates.sort((a, b) => {
            const aScore = a.score + (a.isPreferredType ? 0.1 : 0);
            const bScore = b.score + (b.isPreferredType ? 0.1 : 0);
            return bScore - aScore;
        });
        
        const best = allCandidates[0];
        const confidence = best.score >= 0.9 ? 'high' : best.score >= 0.7 ? 'medium' : 'low';
        
        return {
            success: true,
            resolved: true,
            entity: {
                id: best.id,
                name: best.name,
                code: best.code
            },
            actualType: best.type,
            autoResolved: type === 'auto',
            confidence,
            matchQuality: Math.round(best.score * 100),
            alternateMatches: allCandidates.slice(1, 4).map(c => ({
                id: c.id,
                name: c.name,
                type: c.type
            }))
        };
    }

    /**
     * Legacy: Execute entity resolution for agent tool
     */
    function executeEntityResolution(args) {
        if (!args || !args.term || typeof args.term !== 'string') {
            log.debug('executeEntityResolution called with invalid args', { args: args });
            return {
                success: false,
                error: 'Invalid entity resolution request - missing term'
            };
        }
        
        const result = resolveEntityWithFallback(args.term, args.entity_type);
        
        if (result.resolved) {
            const response = {
                success: true,
                resolved: true,
                id: result.entity.id,
                name: result.entity.name,
                code: result.entity.code,
                confidence: result.confidence,
                message: `Resolved "${args.term}" to "${result.entity.name}" (ID: ${result.entity.id})`
            };
            
            if (result.actualType) {
                response.entityType = result.actualType;
                response.message += ` [found as ${result.actualType}]`;
            }
            
            return response;
        }
        
        if (result.notFound) {
            return {
                success: true,
                notFound: true,
                message: result.message,
                suggestions: result.suggestions?.map(e => ({ id: e.id, name: e.name })) || [],
                guidance: 'No exact match found. Suggest alternatives or ask user to rephrase.'
            };
        }
        
        return result;
    }

    /**
     * Legacy: Get entities of type (for direct queries)
     */
    function getEntitiesOfType(entityType, searchTerm) {
        const config = ENTITY_CONFIG[entityType];
        if (!config) return [];
        
        const termSafe = searchTerm ? escapeSql(searchTerm) : '';
        
        let query;
        if (termSafe) {
            query = `
                SELECT id, ${config.nameField} AS name, ${config.codeField} AS code
                FROM ${config.table}
                WHERE isinactive = 'F'
                  AND (LOWER(${config.nameField}) LIKE '%' || LOWER('${termSafe}') || '%'
                       OR LOWER(${config.codeField}) LIKE '%' || LOWER('${termSafe}') || '%')
                ORDER BY ${config.nameField}
                FETCH FIRST 50 ROWS ONLY
            `;
        } else {
            query = `
                SELECT id, ${config.nameField} AS name, ${config.codeField} AS code
                FROM ${config.table}
                WHERE isinactive = 'F'
                ORDER BY ${config.nameField}
                FETCH FIRST 1000 ROWS ONLY
            `;
        }
        
        try {
            const result = QueryExecutor.executeQuery(query);
            if (result.success && result.rows) {
                return result.rows.map(r => ({
                    id: r.id,
                    name: r.name,
                    code: r.code
                }));
            }
        } catch (e) {
            log.debug('getEntitiesOfType failed', { type: entityType, error: e.message });
        }
        
        return [];
    }

    /**
     * Legacy: Search entities directly
     */
    function searchEntitiesDirectly(entityType, searchTerm) {
        return getEntitiesOfType(entityType, searchTerm);
    }

    /**
     * Legacy: Find matches in entity list
     */
    function findMatches(term, entities) {
        const termLower = term.toLowerCase();
        const exact = [];
        const fuzzy = [];
        
        for (const entity of entities) {
            const nameLower = (entity.name || '').toLowerCase();
            const codeLower = (entity.code || '').toLowerCase();
            
            // Exact match
            if (nameLower === termLower || codeLower === termLower) {
                exact.push(entity);
                continue;
            }
            
            // Starts with
            if (nameLower.startsWith(termLower) || codeLower.startsWith(termLower)) {
                fuzzy.push({ entity, matchType: 'starts_with', score: 90 });
                continue;
            }
            
            // Contains
            if (nameLower.includes(termLower)) {
                fuzzy.push({ entity, matchType: 'contains', score: 70 });
                continue;
            }
            
            // Levenshtein
            if (termLower.length >= 3) {
                const distance = levenshteinDistance(termLower, nameLower.substring(0, termLower.length + 2));
                if (distance <= 2) {
                    fuzzy.push({ entity, matchType: 'similar', score: 50 - distance * 10 });
                }
            }
        }
        
        fuzzy.sort((a, b) => b.score - a.score);
        return { exact, fuzzy };
    }

    /**
     * Legacy: Get similar entities
     */
    function getSimilarEntities(term, entities, limit) {
        const termLower = term.toLowerCase();
        const scored = entities.map(entity => {
            const nameLower = (entity.name || '').toLowerCase();
            let score = 1000;
            
            if (nameLower.includes(termLower)) {
                score = 10;
            } else if (nameLower.startsWith(termLower[0])) {
                score = 100 + levenshteinDistance(termLower, nameLower.substring(0, termLower.length + 3));
            } else {
                score = 200 + levenshteinDistance(termLower, nameLower.substring(0, Math.min(termLower.length + 3, nameLower.length)));
            }
            
            return { entity, score };
        });
        
        scored.sort((a, b) => a.score - b.score);
        return scored.slice(0, limit).map(s => s.entity);
    }


    // ═══════════════════════════════════════════════════════════════════════════
    // UTILITY: PARSE ENTITY MARKERS FROM ENRICHED MESSAGE
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Parse entity markers from an enriched message
     * Markers are in format: [[TYPE:ID:NAME]]
     * @param {string} enrichedMessage - Message with entity markers
     * @returns {object} { entities: [...], cleanMessage: string }
     */
    function parseEntityMarkers(enrichedMessage) {
        const entities = [];
        const markerPattern = /\[\[(\w+):(\d+):([^\]]+)\]\]/g;
        
        let match;
        while ((match = markerPattern.exec(enrichedMessage)) !== null) {
            entities.push({
                type: match[1].toLowerCase(),
                id: parseInt(match[2], 10),
                name: match[3],
                marker: match[0]
            });
        }
        
        // Create clean message with entity names instead of markers
        let cleanMessage = enrichedMessage;
        for (const entity of entities) {
            cleanMessage = cleanMessage.replace(entity.marker, entity.name);
        }
        
        return { entities, cleanMessage };
    }

    /**
     * Convert parsed entity markers to resolvedEntities format
     * @param {array} entities - Array from parseEntityMarkers
     * @returns {object} Object keyed by entity name
     */
    function markersToResolvedEntities(entities) {
        const resolved = {};
        for (const entity of entities) {
            const key = entity.name.toLowerCase().replace(/[^a-z0-9]/g, '_');
            resolved[key] = {
                id: entity.id,
                name: entity.name,
                type: entity.type
            };
        }
        return resolved;
    }


    // ═══════════════════════════════════════════════════════════════════════════
    // PUBLIC API
    // ═══════════════════════════════════════════════════════════════════════════

    return {
        // ═══ SESSION CONTEXT HELPERS (use these to manage entities) ═══
        recordResolvedEntity: recordResolvedEntity,
        getMostRecentEntity: getMostRecentEntity,
        getMostRecentEntityOfType: getMostRecentEntityOfType,
        normalizeEntityKey: normalizeEntityKey,
        
        // ═══ Primary interface for pre-planner resolution ═══
        resolveEntitiesInMessage: resolveEntitiesInMessage,
        
        // ═══ Individual layers (for testing/debugging) ═══
        resolveCoreferences: resolveCoreferences,
        extractEntityMentions: extractEntityMentions,
        resolveFromDatabase: resolveFromDatabase,
        resolveWithLLM: resolveWithLLM,
        
        // ═══ Marker utilities ═══
        parseEntityMarkers: parseEntityMarkers,
        markersToResolvedEntities: markersToResolvedEntities,
        
        // ═══ Legacy compatibility ═══
        resolveEntity: resolveEntitySync,
        resolveEntityWithFallback: resolveEntityWithFallback,
        executeEntityResolution: executeEntityResolution,
        
        // ═══ Legacy: Entity queries ═══
        getEntitiesOfType: getEntitiesOfType,
        searchEntitiesDirectly: searchEntitiesDirectly,
        
        // ═══ Legacy: Matching utilities ═══
        findMatches: findMatches,
        getSimilarEntities: getSimilarEntities,
        levenshteinDistance: levenshteinDistance,
        
        // ═══ Utilities ═══
        ENTITY_CONFIG: ENTITY_CONFIG
    };
});