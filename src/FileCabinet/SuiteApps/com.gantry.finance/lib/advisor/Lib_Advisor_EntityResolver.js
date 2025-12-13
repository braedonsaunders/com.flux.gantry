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
    './Lib_Advisor_AIProviders',
    './Lib_Advisor_Utils'
], function(log, QueryExecutor, AIProviders, Utils) {
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

    // ═══════════════════════════════════════════════════════════════════════════
    // CONFIDENCE AND AMBIGUITY THRESHOLDS
    // Prevents false positives like "AR" matching "Arkansas Corp"
    // ═══════════════════════════════════════════════════════════════════════════

    const RESOLUTION_CONFIG = {
        // Minimum term length for substring matching (prevents "AR" matching "Barbara")
        MIN_SUBSTRING_TERM_LENGTH: 3,

        // Confidence thresholds
        HIGH_CONFIDENCE_THRESHOLD: 0.90,    // Exact match or starts-with
        MEDIUM_CONFIDENCE_THRESHOLD: 0.70,  // Contains match
        LOW_CONFIDENCE_THRESHOLD: 0.50,     // Fuzzy/partial match

        // Ambiguity detection
        AMBIGUITY_SCORE_DIFF: 0.15,         // If top matches within this range, flag as ambiguous
        MAX_AMBIGUOUS_SUGGESTIONS: 5,       // How many alternatives to show for disambiguation

        // Minimum confidence to accept a match
        MINIMUM_ACCEPTABLE_CONFIDENCE: 0.50
    };

    // Use centralized SQL escaping from Utils
    const escapeSql = Utils.escapeSql;
    const escapeSqlLike = Utils.escapeSqlLike;

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
                SELECT * FROM (
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
                ) WHERE ROWNUM <= 10
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
                resolved: false,
                message: `No entity found matching "${userTerm}"`,
                confidence: 'none',
                suggestions: []
            };
        }

        // ═══════════════════════════════════════════════════════════════════════
        // CONFIDENCE THRESHOLD CHECK
        // For short search terms (< 3 chars), require higher confidence
        // This prevents "AR" from matching "Arkansas Corp" with medium confidence
        // ═══════════════════════════════════════════════════════════════════════
        const termLength = term.length;
        const requiresHighConfidence = termLength < RESOLUTION_CONFIG.MIN_SUBSTRING_TERM_LENGTH;

        // Filter candidates based on term length and confidence
        let filteredCandidates = allCandidates;
        if (requiresHighConfidence) {
            // For short terms, only accept exact matches or starts-with
            filteredCandidates = allCandidates.filter(c => c.score >= RESOLUTION_CONFIG.HIGH_CONFIDENCE_THRESHOLD);

            if (filteredCandidates.length === 0) {
                // No high-confidence matches for short term
                log.debug('Short term requires high confidence', {
                    term: term,
                    termLength: termLength,
                    candidates: allCandidates.length,
                    topScore: allCandidates[0]?.score
                });

                return {
                    success: true,
                    notFound: true,
                    resolved: false,
                    message: `Search term "${userTerm}" is too short for reliable matching. Please provide more characters.`,
                    confidence: 'none',
                    suggestions: allCandidates.slice(0, RESOLUTION_CONFIG.MAX_AMBIGUOUS_SUGGESTIONS).map(c => ({
                        id: c.id,
                        name: c.name,
                        type: c.type,
                        score: c.score
                    })),
                    shortTermWarning: true
                };
            }
        }

        // Sort by score (with preferred type bonus)
        filteredCandidates.sort((a, b) => {
            const aScore = a.score + (a.isPreferredType ? 0.1 : 0);
            const bScore = b.score + (b.isPreferredType ? 0.1 : 0);
            return bScore - aScore;
        });

        const best = filteredCandidates[0];

        // ═══════════════════════════════════════════════════════════════════════
        // AMBIGUITY DETECTION
        // If multiple matches have similar scores, flag as ambiguous
        // User should clarify which entity they meant
        // ═══════════════════════════════════════════════════════════════════════
        const isAmbiguous = detectAmbiguity(filteredCandidates, best.score);

        if (isAmbiguous.ambiguous) {
            log.debug('Ambiguous entity match detected', {
                term: term,
                topMatches: isAmbiguous.topMatches.map(m => `${m.name}(${m.score})`)
            });

            return {
                success: true,
                resolved: true,
                ambiguous: true,
                entity: {
                    id: best.id,
                    name: best.name,
                    code: best.code
                },
                actualType: best.type,
                autoResolved: type === 'auto',
                confidence: 'low',
                matchQuality: Math.round(best.score * 100),
                ambiguityMessage: `Multiple matches found for "${userTerm}". Using best match "${best.name}" but you may want to clarify.`,
                alternatives: isAmbiguous.topMatches.slice(1).map(c => ({
                    id: c.id,
                    name: c.name,
                    type: c.type,
                    score: Math.round(c.score * 100)
                }))
            };
        }

        // Clear match - return with confidence
        const confidence = best.score >= RESOLUTION_CONFIG.HIGH_CONFIDENCE_THRESHOLD ? 'high' :
                          best.score >= RESOLUTION_CONFIG.MEDIUM_CONFIDENCE_THRESHOLD ? 'medium' : 'low';

        return {
            success: true,
            resolved: true,
            ambiguous: false,
            entity: {
                id: best.id,
                name: best.name,
                code: best.code
            },
            actualType: best.type,
            autoResolved: type === 'auto',
            confidence,
            matchQuality: Math.round(best.score * 100),
            alternateMatches: filteredCandidates.slice(1, 4).map(c => ({
                id: c.id,
                name: c.name,
                type: c.type,
                score: Math.round(c.score * 100)
            }))
        };
    }

    /**
     * Detect if entity matches are ambiguous (multiple similar-scoring matches)
     * @param {Array} candidates - Sorted list of candidates
     * @param {number} topScore - Score of the best match
     * @returns {Object} { ambiguous: boolean, topMatches: Array }
     */
    function detectAmbiguity(candidates, topScore) {
        if (candidates.length < 2) {
            return { ambiguous: false, topMatches: candidates };
        }

        // Find all candidates within the ambiguity threshold of the top score
        const ambiguityThreshold = topScore - RESOLUTION_CONFIG.AMBIGUITY_SCORE_DIFF;
        const topMatches = candidates.filter(c => c.score >= ambiguityThreshold);

        // If we have multiple matches with very similar scores, it's ambiguous
        // Also check if the best match isn't a clear winner (not high confidence)
        const isAmbiguous = topMatches.length > 1 && topScore < RESOLUTION_CONFIG.HIGH_CONFIDENCE_THRESHOLD;

        return {
            ambiguous: isAmbiguous,
            topMatches: topMatches.slice(0, RESOLUTION_CONFIG.MAX_AMBIGUOUS_SUGGESTIONS)
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
                SELECT * FROM (
                    SELECT id, ${config.nameField} AS name, ${config.codeField} AS code
                    FROM ${config.table}
                    WHERE isinactive = 'F'
                      AND (LOWER(${config.nameField}) LIKE '%' || LOWER('${termSafeLike}') || '%' ESCAPE '\\'
                           OR LOWER(${config.codeField}) LIKE '%' || LOWER('${termSafeLike}') || '%' ESCAPE '\\')
                    ORDER BY ${config.nameField}
                ) WHERE ROWNUM <= 50
            `;
        } else {
            query = `
                SELECT * FROM (
                    SELECT id, ${config.nameField} AS name, ${config.codeField} AS code
                    FROM ${config.table}
                    WHERE isinactive = 'F'
                    ORDER BY ${config.nameField}
                ) WHERE ROWNUM <= 1000
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

    // ═══════════════════════════════════════════════════════════════════════════
    // PUBLIC API
    // ═══════════════════════════════════════════════════════════════════════════

    return {
        // ═══ Primary interface (v2 - LLM-driven resolution) ═══
        resolveEntity: resolveEntitySync,
        resolveEntityWithFallback: resolveEntityWithFallback,
        executeEntityResolution: executeEntityResolution,

        // ═══ Entity queries ═══
        getEntitiesOfType: getEntitiesOfType,
        searchEntitiesDirectly: searchEntitiesDirectly,

        // ═══ Configuration ═══
        ENTITY_CONFIG: ENTITY_CONFIG
    };
});