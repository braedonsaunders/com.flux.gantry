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
    // DYNAMIC ENTITY DISCOVERY
    // Allows resolution of custom entity types and custom records
    // ═══════════════════════════════════════════════════════════════════════════

    // In-memory cache for dynamic entity configs (persists for request lifecycle)
    const dynamicConfigCache = {};

    /**
     * Find the ID field from a list of schema fields
     * Priority: id, internalid, recordid, then any *id field
     * @param {Array} fields - Array of field objects with id and type properties
     * @returns {string} The identified ID field name
     */
    function findIdField(fields) {
        // Priority order for ID fields
        const priorities = ['id', 'internalid', 'recordid'];
        for (const p of priorities) {
            if (fields.find(f => f.id.toLowerCase() === p)) return p;
        }
        // Fallback to first id-like field that's an integer
        const idField = fields.find(f => f.id.toLowerCase().endsWith('id') && f.type === 'integer');
        return idField?.id || 'id';
    }

    /**
     * Find the name field from a list of schema fields
     * Priority: common name fields, then first text field
     * @param {Array} fields - Array of field objects with id and type properties
     * @returns {string} The identified name field name
     */
    function findNameField(fields) {
        // Priority order for name fields
        const priorities = ['companyname', 'entityid', 'name', 'displayname', 'title', 'altname'];
        for (const p of priorities) {
            if (fields.find(f => f.id.toLowerCase() === p)) return p;
        }
        // Fallback to first text field
        const textField = fields.find(f => f.type === 'text' || f.type === 'varchar');
        return textField?.id || 'name';
    }

    /**
     * Find all text fields suitable for search
     * @param {Array} fields - Array of field objects with id and type properties
     * @returns {Array} Array of searchable field names (max 5)
     */
    function findSearchableFields(fields) {
        return fields
            .filter(f => ['text', 'varchar', 'email'].includes(f.type?.toLowerCase()))
            .map(f => f.id)
            .slice(0, 5); // Limit to 5 fields for performance
    }

    /**
     * Discover entity configuration dynamically for unknown types
     * Uses schema introspection to find name/id fields
     * @param {string} recordType - The record type to discover
     * @param {Object} context - Optional context with cache
     * @returns {Object|null} Entity config or null if not discoverable
     */
    function discoverEntityConfig(recordType, context) {
        // Check in-memory cache first
        const cacheKey = `entity_config_${recordType}`;
        if (dynamicConfigCache[cacheKey]) {
            return dynamicConfigCache[cacheKey];
        }

        // Check context cache if available
        const cached = context?.cache?.get?.(cacheKey);
        if (cached) {
            dynamicConfigCache[cacheKey] = cached;
            return cached;
        }

        try {
            // Use existing dynamic schema discovery from Utils
            const schema = Utils.getRecordSchema ? Utils.getRecordSchema(recordType) : null;

            if (!schema || !schema.fields) {
                log.debug('Could not get schema for record type', { recordType: recordType });
                return null;
            }

            const fields = schema.fields;

            // Build config heuristically from schema
            const config = {
                table: recordType,
                idField: findIdField(fields),
                nameField: findNameField(fields),
                codeField: findNameField(fields), // Use name field as code field fallback
                searchFields: findSearchableFields(fields),
                isDynamic: true
            };

            // Cache for future use
            dynamicConfigCache[cacheKey] = config;
            if (context?.cache?.set) {
                context.cache.set(cacheKey, config, 3600); // 1 hour TTL
            }

            log.debug('Dynamically discovered entity config', {
                recordType: recordType,
                config: config
            });

            return config;
        } catch (error) {
            log.debug('Could not discover entity config', {
                recordType: recordType,
                error: error.message || error
            });
            return null;
        }
    }

    /**
     * Get entity configuration, checking static config first then dynamic discovery
     * @param {string} entityType - The entity type to get config for
     * @param {Object} context - Optional context with cache
     * @returns {Object|null} Entity config or null if not found
     */
    function getEntityConfig(entityType, context) {
        // Check static config first (faster)
        if (ENTITY_CONFIG[entityType]) {
            return ENTITY_CONFIG[entityType];
        }

        // Try dynamic discovery for unknown types
        const dynamicConfig = discoverEntityConfig(entityType, context);

        if (dynamicConfig) {
            log.debug('Using dynamically discovered entity config', { entityType: entityType });
            return dynamicConfig;
        }

        // Return null - will trigger 'auto' fallback
        return null;
    }

    /**
     * Discover custom records that might be entity-like
     * Finds custom record types with name-like fields
     * @param {Object} context - Context for query execution
     * @returns {Array} Array of custom record scriptids
     */
    function discoverCustomEntityRecords(context) {
        // Check cache first
        const cacheKey = 'custom_entity_records';
        if (dynamicConfigCache[cacheKey]) {
            return dynamicConfigCache[cacheKey];
        }

        const sql = `
            SELECT scriptid
            FROM customrecordtype
            WHERE scriptid LIKE 'customrecord_%'
            ORDER BY scriptid
            FETCH FIRST 20 ROWS ONLY
        `;

        try {
            const result = QueryExecutor.executeQuery(sql);
            if (result.success && result.rows) {
                const records = result.rows.map(r => r.scriptid);
                dynamicConfigCache[cacheKey] = records;
                return records;
            }
        } catch (error) {
            log.debug('Could not discover custom entity records', {
                error: error.message || error
            });
        }

        return [];
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
     * Search for entities in a specific table using the provided config
     * @param {string} term - Search term
     * @param {Object} config - Entity configuration with table, nameField, codeField
     * @param {string} entityType - The entity type being searched
     * @param {string} preferredType - Optional preferred type for scoring
     * @returns {Array} Array of matching candidates
     */
    function searchEntityInTable(term, config, entityType, preferredType) {
        const candidates = [];

        const termSafe = escapeSql(term);
        const termSafeLike = escapeSqlLike(term);

        // Build query, handling cases where codeField might not exist
        const codeFieldSelect = config.codeField ? `, ${config.codeField} AS code` : '';
        const codeFieldWhere = config.codeField
            ? `OR LOWER(${config.codeField}) LIKE '%' || LOWER('${termSafeLike}') || '%' ESCAPE '\\'`
            : '';

        const query = `
            SELECT * FROM (
                SELECT
                    id,
                    ${config.nameField} AS name
                    ${codeFieldSelect},
                    CASE
                        WHEN LOWER(${config.nameField}) = LOWER('${termSafe}') THEN 1.00
                        WHEN LOWER(${config.nameField}) LIKE LOWER('${termSafeLike}') || '%' ESCAPE '\\' THEN 0.90
                        WHEN LOWER(${config.nameField}) LIKE '%' || LOWER('${termSafeLike}') || '%' ESCAPE '\\' THEN 0.75
                        ELSE 0.50
                    END AS match_score
                FROM ${config.table}
                WHERE isinactive = 'F'
                  AND (LOWER(${config.nameField}) LIKE '%' || LOWER('${termSafeLike}') || '%' ESCAPE '\\'
                       ${codeFieldWhere})
                ORDER BY match_score DESC
            ) WHERE ROWNUM <= 10
        `;

        try {
            const result = QueryExecutor.executeQuery(query);
            if (result.success && result.rows && result.rows.length > 0) {
                for (const row of result.rows) {
                    candidates.push({
                        id: row.id,
                        name: row.name,
                        code: row.code || row.name,
                        type: entityType,
                        score: parseFloat(row.match_score) || 0.5,
                        isPreferredType: entityType === preferredType,
                        isDynamic: config.isDynamic || false
                    });
                }
            }
        } catch (e) {
            log.debug('Entity search failed', { type: entityType, table: config.table, error: e.message });
        }

        return candidates;
    }

    /**
     * Resolve entity in auto mode, searching all standard types and custom records
     * @param {string} term - Search term
     * @param {string} preferredType - Optional preferred type for ranking
     * @param {Object} context - Optional context
     * @returns {Array} Array of all matching candidates
     */
    function resolveEntityAuto(term, preferredType, context) {
        const allCandidates = [];

        // Search standard entity types first
        for (const [type, config] of Object.entries(ENTITY_CONFIG)) {
            const matches = searchEntityInTable(term, config, type, preferredType);
            allCandidates.push(...matches);
        }

        // Also search discovered custom record types
        try {
            const customRecordTypes = discoverCustomEntityRecords(context);
            for (const customType of customRecordTypes) {
                try {
                    const config = discoverEntityConfig(customType, context);
                    if (config) {
                        const matches = searchEntityInTable(term, config, customType, preferredType);
                        allCandidates.push(...matches);
                    }
                } catch (e) {
                    // Skip custom records that fail - continue with others
                    log.debug('Skipping custom record in auto search', { type: customType, error: e.message });
                }
            }
        } catch (e) {
            log.debug('Custom record discovery failed in auto mode', { error: e.message });
        }

        return allCandidates;
    }

    /**
     * Rank entity matches by score and preferred type
     * @param {Array} candidates - Array of candidate matches
     * @param {string} preferredType - Optional preferred type for bonus
     * @returns {Array} Sorted array of candidates
     */
    function rankEntityMatches(candidates, preferredType) {
        return candidates.sort((a, b) => {
            const aScore = a.score + (a.isPreferredType ? 0.1 : 0);
            const bScore = b.score + (b.isPreferredType ? 0.1 : 0);
            return bScore - aScore;
        });
    }

    /**
     * Synchronous entity resolution (for legacy code)
     * Enhanced to support dynamic discovery of unknown entity types
     */
    function resolveEntitySync(userTerm, entityType, preferredType, context) {
        if (!userTerm || typeof userTerm !== 'string') {
            return { success: false, error: 'Missing or invalid userTerm' };
        }

        const term = userTerm.trim();
        let type = entityType || 'auto';

        // For specific entity types (not auto), try to get config
        if (type !== 'auto') {
            const config = getEntityConfig(type, context);

            if (!config) {
                // Unknown type - try dynamic discovery before falling back to auto
                const dynamicConfig = discoverEntityConfig(type, context);

                if (!dynamicConfig) {
                    log.warn('Unknown entity type, falling back to auto', { requestedType: type });
                    type = 'auto';
                }
            }
        }

        let allCandidates = [];

        if (type === 'auto') {
            // Use auto resolution which includes custom records
            allCandidates = resolveEntityAuto(term, preferredType, context);
        } else {
            // Search specific type (static or dynamically discovered)
            const config = getEntityConfig(type, context);
            if (config) {
                allCandidates = searchEntityInTable(term, config, type, preferredType);
            }

            // If no results for specific type, fall back to auto mode
            if (allCandidates.length === 0) {
                log.debug('No results for specific type, falling back to auto', { type: type });
                allCandidates = resolveEntityAuto(term, preferredType, context);
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

        // ═══ Dynamic discovery ═══
        discoverEntityConfig: discoverEntityConfig,
        getEntityConfig: getEntityConfig,
        discoverCustomEntityRecords: discoverCustomEntityRecords,
        resolveEntityAuto: resolveEntityAuto,

        // ═══ Configuration ═══
        ENTITY_CONFIG: ENTITY_CONFIG
    };
});