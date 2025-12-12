/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 *
 * Lib_Advisor_EntityResolver.js
 * Entity Resolution Engine for the Advisor module (v2)
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * V2 ARCHITECTURE:
 * The LLM decides WHEN to resolve entities via the `resolve_entity` tool
 * (Lib_Advisor_Tools.js). No automatic regex extraction.
 *
 * Flow: Message → LLM Agent → LLM calls resolve_entity tool → DB lookup
 *
 * This eliminates catastrophic failures where regex misidentified entities
 * (e.g., "Drill down" → "Drill Press" inventory item).
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Design Principles:
 * - Zero configuration - works in any NetSuite instance
 * - No caching (stateless per request - NetSuite limitation)
 * - No hardcoded aliases (dynamically learns from data)
 */
define([
    'N/log',
    './Lib_Advisor_QueryExecutor',
    './Lib_Advisor_AIProviders'
], function(log, QueryExecutor, AIProviders) {
    'use strict';

    // ═══════════════════════════════════════════════════════════════════════════
    // CONFIGURATION
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
     * Escape SQL LIKE pattern characters (% and _) in addition to SQL escaping
     * Use this when the value will be used in a LIKE clause
     */
    function escapeSqlLike(str) {
        if (!str) return '';
        // First escape SQL quotes, then escape LIKE wildcards
        return String(str).replace(/'/g, "''").replace(/%/g, '\\%').replace(/_/g, '\\_');
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // UTILITY FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════

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


    // ═══════════════════════════════════════════════════════════════════════════
    // PRIMARY RESOLUTION INTERFACE (v2 - LLM-driven)
    // These functions are called by the resolve_entity tool
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
            const termSafeLike = escapeSqlLike(term);
            const query = `
                SELECT
                    id,
                    ${config.nameField} AS name,
                    ${config.codeField} AS code,
                    CASE
                        WHEN LOWER(${config.nameField}) = LOWER('${termSafe}') THEN 1.00
                        WHEN LOWER(${config.nameField}) LIKE LOWER('${termSafeLike}') || '%' ESCAPE '\\' THEN 0.90
                        WHEN LOWER(${config.nameField}) LIKE '%' || LOWER('${termSafeLike}') || '%' ESCAPE '\\' THEN 0.75
                        ELSE 0.50
                    END AS match_score
                FROM ${config.table}
                WHERE isinactive = 'F'
                  AND (LOWER(${config.nameField}) LIKE '%' || LOWER('${termSafeLike}') || '%' ESCAPE '\\'
                       OR LOWER(${config.codeField}) LIKE '%' || LOWER('${termSafeLike}') || '%' ESCAPE '\\')
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
     * FIXED: Uses escapeSqlLike for LIKE clauses to prevent SQL injection via wildcards
     */
    function getEntitiesOfType(entityType, searchTerm) {
        const config = ENTITY_CONFIG[entityType];
        if (!config) return [];

        // FIXED: Use escapeSqlLike for LIKE clauses (escapes % and _ wildcards)
        const termSafeLike = searchTerm ? escapeSqlLike(searchTerm) : '';

        let query;
        if (termSafeLike) {
            query = `
                SELECT id, ${config.nameField} AS name, ${config.codeField} AS code
                FROM ${config.table}
                WHERE isinactive = 'F'
                  AND (LOWER(${config.nameField}) LIKE '%' || LOWER('${termSafeLike}') || '%' ESCAPE '\\'
                       OR LOWER(${config.codeField}) LIKE '%' || LOWER('${termSafeLike}') || '%' ESCAPE '\\')
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
        // ═══ Primary interface (v2 - LLM-driven resolution) ═══
        resolveEntity: resolveEntitySync,
        resolveEntityWithFallback: resolveEntityWithFallback,
        executeEntityResolution: executeEntityResolution,

        // ═══ Marker utilities ═══
        parseEntityMarkers: parseEntityMarkers,
        markersToResolvedEntities: markersToResolvedEntities,

        // ═══ Entity queries ═══
        getEntitiesOfType: getEntitiesOfType,
        searchEntitiesDirectly: searchEntitiesDirectly,

        // ═══ Matching utilities ═══
        findMatches: findMatches,
        getSimilarEntities: getSimilarEntities,
        levenshteinDistance: levenshteinDistance,

        // ═══ Utilities ═══
        ENTITY_CONFIG: ENTITY_CONFIG
    };
});