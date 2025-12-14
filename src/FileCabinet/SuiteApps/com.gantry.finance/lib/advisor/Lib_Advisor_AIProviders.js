/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * 
 * Lib_Advisor_AIProviders.js
 * AI Provider implementations for the Advisor module
 * 
 * Contains:
 * - Unified callAI interface
 * - NetSuite (Cohere) provider
 * - OpenAI provider
 * - Anthropic provider
 * - Google Gemini provider
 * - Model configuration and tier management
 */
define([
    'N/log',
    'N/llm',
    'N/https',
    '../Lib_Config',
    '../Lib_Model_Registry',
    './Lib_Advisor_Utils'
], function(log, llm, https, ConfigLib, ModelRegistry, Utils) {
    'use strict';

    const DEFAULT_MAX_TOKENS = Utils.DEFAULT_MAX_TOKENS;
    
    // Module-level storage for N/llm discovery info (for debugging)
    let _nllmDiscoveryInfo = null;
    
    // Track AI calls for debugging/display
    let aiCallLog = [];

    /**
     * Get appropriate max tokens for a model
     * Uses Model Registry to get model-specific limits, with sensible defaults
     * @param {string} modelId - The model identifier
     * @param {string} [purpose] - Optional purpose to apply context-specific limits
     * @returns {number} - Maximum tokens to request
     */
    function getMaxTokensForModel(modelId, purpose) {
        // ═══════════════════════════════════════════════════════════════
        // STREAMING CONTEXT ARCHITECTURE (SCA) - Lightweight token limits
        // Each phase uses minimal tokens for fast responses
        // ═══════════════════════════════════════════════════════════════
        if (purpose && purpose.startsWith('SCA:')) {
            const scaLimits = Utils.SCA_TOKEN_LIMITS || {};
            // Check for exact match first (e.g., 'SCA:intent')
            if (scaLimits[purpose]) {
                return scaLimits[purpose];
            }
            // Check for phase prefix (e.g., 'SCA:invoke:get_customer_revenue' → 'SCA:invoke')
            const phasePrefix = purpose.split(':').slice(0, 2).join(':');
            if (scaLimits[phasePrefix]) {
                return scaLimits[phasePrefix];
            }
            // Default SCA limit - still smaller than legacy
            return 500;
        }

        // Context-specific limits for cases where we know output should be small
        const purposeLimits = {
            'classification': 200 // Simple classification
        };

        if (purpose && purposeLimits[purpose]) {
            return purposeLimits[purpose];
        }

        // Get model-specific max output from registry
        if (modelId) {
            try {
                const modelInfo = ModelRegistry.getModel(modelId);
                if (modelInfo && modelInfo.maxOutput) {
                    return modelInfo.maxOutput;
                }
            } catch (e) {
                log.debug('Could not get model info for max tokens', { model: modelId, error: e.message });
            }
        }

        return DEFAULT_MAX_TOKENS;
    }

    /**
     * Recursively sanitize tool parameters for Gemini API
     * Gemini does not allow empty strings in enum arrays
     * @param {Object} params - The parameters object to sanitize
     * @returns {Object} - Sanitized parameters with empty enum values removed
     */
    function sanitizeParametersForGemini(params) {
        if (!params || typeof params !== 'object') {
            return params;
        }

        const result = Array.isArray(params) ? [] : {};

        for (const key in params) {
            if (!params.hasOwnProperty(key)) continue;

            const value = params[key];

            if (key === 'enum' && Array.isArray(value)) {
                // Filter out empty strings from enum arrays
                result[key] = value.filter(item => item !== '');
            } else if (value && typeof value === 'object') {
                // Recursively sanitize nested objects
                result[key] = sanitizeParametersForGemini(value);
            } else {
                result[key] = value;
            }
        }

        return result;
    }

    /**
     * Get NetSuite model family for a model name
     * Must be a function since llm.ModelFamily can't be accessed during define()
     * Uses dynamic lookup with fallback for future NetSuite model additions
     */
    function getNetSuiteModelFamily(modelName) {
        if (!modelName) {
            log.debug('No NetSuite model name provided, using default');
            return llm.ModelFamily.COHERE_COMMAND_A;
        }
        
        // Try dynamic lookup first (handles new models NetSuite adds)
        const normalizedName = modelName.toUpperCase().replace(/-/g, '_');
        if (llm.ModelFamily[normalizedName]) {
            return llm.ModelFamily[normalizedName];
        }
        
        // Fallback to known models for backwards compatibility
        const knownModels = {
            'cohere-command-a': llm.ModelFamily.COHERE_COMMAND_A,
            'cohere-command-r-plus': llm.ModelFamily.COHERE_COMMAND_R_PLUS,
            'cohere-command-r': llm.ModelFamily.COHERE_COMMAND_R,
            'meta-llama3': llm.ModelFamily.META_LLAMA3
        };
        
        return knownModels[modelName] || llm.ModelFamily.COHERE_COMMAND_A;
    }

    /**
     * Get the appropriate model for a task based on tier and AI mode
     * Supports modes: smart (uses tiers), max (always tier 3), light (always tier 1), custom
     * @returns {Object} { provider, model } - The provider and model to use
     */
    function getModelForTier(provider, tier, aiConfig) {
        // Determine effective tier based on AI mode
        const mode = aiConfig.aiMode || 'smart';
        let effectiveTier = tier;
        
        if (mode === 'max') {
            // Always use premium tier 3
            effectiveTier = 3;
        } else if (mode === 'light') {
            // Always use fast tier 1
            effectiveTier = 1;
        }
        // 'smart' and 'custom' modes use the tier as-is
        
        // Build tier config - custom mode uses explicit tier models
        let tierConfig = null;
        
        if (mode === 'custom' || aiConfig.tierConfigEnabled) {
            // Get provider from tier models (auto-detect from model name)
            const getProviderFromModel = (model) => {
                if (!model) return 'gemini';
                if (model.startsWith('gemini')) return 'gemini';
                if (model.startsWith('claude')) return 'anthropic';
                if (model.startsWith('gpt')) return 'openai';
                if (model.startsWith('cohere') || model.startsWith('meta-')) return 'netsuite';
                return 'gemini';
            };
            
            tierConfig = {
                tierConfigEnabled: true,
                tier1Provider: aiConfig.tier1Provider || getProviderFromModel(aiConfig.tier1Model),
                tier1Model: aiConfig.tier1Model || 'gemini-2.5-flash-lite',
                tier2Provider: aiConfig.tier2Provider || getProviderFromModel(aiConfig.tier2Model),
                tier2Model: aiConfig.tier2Model || 'gemini-2.5-flash',
                tier3Provider: aiConfig.tier3Provider || getProviderFromModel(aiConfig.tier3Model),
                tier3Model: aiConfig.tier3Model || 'gemini-2.5-pro'
            };
        }
        
        const selectedModel = provider === 'netsuite' ? aiConfig.netsuiteModel :
                             provider === 'openai' ? aiConfig.openaiModel :
                             provider === 'anthropic' ? aiConfig.anthropicModel :
                             provider === 'gemini' ? aiConfig.geminiModel : null;
        
        // ModelRegistry now returns { provider, model }
        const result = ModelRegistry.getModelForTier(provider, effectiveTier, selectedModel, tierConfig);
        
        log.debug('Model selection', { 
            mode: mode,
            originalTier: tier,
            effectiveTier: effectiveTier,
            result: JSON.stringify(result)
        });
        
        // Handle both old string return and new object return for compatibility
        if (typeof result === 'string') {
            return { provider: provider, model: result };
        }
        return result;
    }

    /**
     * Get model info for display - delegates to ModelRegistry
     */
    function getModelDisplayInfo(model) {
        return ModelRegistry.getModelDisplayInfo(model);
    }

    /**
     * Get AI configuration from settings
     */
    function getAIConfig() {
        try {
            // Use getStoredConfiguration - getConfig doesn't exist!
            const config = ConfigLib.getStoredConfiguration('main') || {};
            
            // Validate provider
            const validProviders = ['netsuite', 'openai', 'anthropic', 'gemini', 'openrouter', 'grok'];
            let provider = config.aiProvider || 'netsuite';
            if (!validProviders.includes(provider)) {
                log.audit('Invalid AI provider, defaulting to netsuite', { configured: provider });
                provider = 'netsuite';
            }
            
            // Map model names - handle invalid/old model names
            let geminiModel = config.geminiModel || 'gemini-2.5-flash';
            // Allow any gemini model - Google releases new ones frequently
            // Just validate it starts with 'gemini'
            if (!geminiModel.startsWith('gemini')) {
                log.audit('Invalid Gemini model, using default', { configured: geminiModel });
                geminiModel = ModelRegistry.getDefaultModel('gemini') || 'gemini-2.5-flash';
            }
            
            const aiConfig = {
                // AI Mode: smart (default), max, light, custom
                aiMode: config.aiMode || 'smart',
                provider: provider,
                // Use ModelRegistry for default models instead of hardcoding
                netsuiteModel: config.netsuiteModel || ModelRegistry.getDefaultModel('netsuite') || 'cohere-command-a',
                openaiApiKey: config.openaiApiKey && config.openaiApiKey !== 'undefined' ? config.openaiApiKey : '',
                openaiModel: config.openaiModel || ModelRegistry.getDefaultModel('openai') || 'gpt-4.1',
                anthropicApiKey: config.anthropicApiKey && config.anthropicApiKey !== 'undefined' ? config.anthropicApiKey : '',
                anthropicModel: config.anthropicModel || ModelRegistry.getDefaultModel('anthropic') || 'claude-sonnet-4-5-20250929',
                geminiApiKey: config.geminiApiKey && config.geminiApiKey !== 'undefined' ? config.geminiApiKey : '',
                geminiModel: geminiModel,
                // OpenRouter - access to 100+ models via single API
                openrouterApiKey: config.openrouterApiKey && config.openrouterApiKey !== 'undefined' ? config.openrouterApiKey : '',
                openrouterModel: config.openrouterModel || ModelRegistry.getDefaultModel('openrouter') || 'anthropic/claude-3.5-sonnet',
                // Grok - xAI's model with real-time knowledge
                grokApiKey: config.grokApiKey && config.grokApiKey !== 'undefined' ? config.grokApiKey : '',
                grokModel: config.grokModel || ModelRegistry.getDefaultModel('grok') || 'grok-3',
                // Parse temperature with validation - handle NaN and clamp to valid range
                temperature: (function() {
                    const parsed = parseFloat(config.aiTemperature || '0.2');
                    if (isNaN(parsed)) return 0.2;
                    return Math.min(Math.max(parsed, 0), 1);  // Clamp to 0-1 range
                })(),
                // Tier configuration - enabled by custom mode or legacy tierConfigEnabled
                tierConfigEnabled: config.aiMode === 'custom' || config.tierConfigEnabled === true || config.tierConfigEnabled === 'true',
                // Tier defaults also from registry
                tier1Provider: config.tier1Provider || 'gemini',
                tier1Model: config.tier1Model || ModelRegistry.getDefaultModel('gemini') || 'gemini-2.5-flash-lite',
                tier2Provider: config.tier2Provider || 'gemini',
                tier2Model: config.tier2Model || ModelRegistry.getDefaultModel('gemini') || 'gemini-2.5-flash',
                tier3Provider: config.tier3Provider || 'gemini',
                tier3Model: config.tier3Model || ModelRegistry.getDefaultModel('gemini') || 'gemini-2.5-pro'
            };
            
            // Debug log to verify config is being read
            log.audit('AI Config Loaded', { 
                aiMode: aiConfig.aiMode,
                provider: aiConfig.provider, 
                model: aiConfig.provider === 'gemini' ? aiConfig.geminiModel : 
                       aiConfig.provider === 'openai' ? aiConfig.openaiModel :
                       aiConfig.provider === 'anthropic' ? aiConfig.anthropicModel :
                       aiConfig.provider === 'openrouter' ? aiConfig.openrouterModel :
                       aiConfig.provider === 'grok' ? aiConfig.grokModel :
                       aiConfig.netsuiteModel,
                hasApiKey: aiConfig.provider === 'gemini' ? !!aiConfig.geminiApiKey :
                          aiConfig.provider === 'openai' ? !!aiConfig.openaiApiKey :
                          aiConfig.provider === 'anthropic' ? !!aiConfig.anthropicApiKey :
                          aiConfig.provider === 'openrouter' ? !!aiConfig.openrouterApiKey :
                          aiConfig.provider === 'grok' ? !!aiConfig.grokApiKey : true
            });
            
            return aiConfig;
        } catch (e) {
            log.error('Could not load AI config, using defaults', { error: e.message });
            return {
                provider: 'netsuite',
                netsuiteModel: 'cohere-command-a',
                temperature: 0.2
            };
        }
    }

    /**
     * Get the model name for display
     */
    function getModelName(aiConfig) {
        switch (aiConfig.provider) {
            case 'openai': return aiConfig.openaiModel;
            case 'anthropic': return aiConfig.anthropicModel;
            case 'gemini': return aiConfig.geminiModel;
            case 'openrouter': return aiConfig.openrouterModel;
            case 'grok': return aiConfig.grokModel;
            default: return aiConfig.netsuiteModel;
        }
    }

    /**
     * Unified AI call interface with provider-specific optimizations
     * @param {string} prompt - The user prompt
     * @param {Object} options - Call options
     * @param {string} options.systemPrompt - System instructions
     * @param {Array} options.chatHistory - Conversation history
     * @param {Array} options.documents - RAG documents (NetSuite only)
     * @param {boolean} options.jsonMode - Request JSON response
     * @param {Array} options.tools - Function/tool definitions
     * @param {number} options.maxTokens - Max response tokens
     * @param {number} options.temperature - Response randomness
     * @param {string} options.purpose - Description of this call for tracking
     * @param {number} options.tier - Model tier: 1 (fast/cheap), 2 (balanced), 3 (premium)
     * @returns {Object} { text, type, toolCalls, model, provider, duration }
     */
    // Debug logging - uses centralized Utils.isDebugMode()
    var aiDebugLog = [];
    
    function addAIDebug(label, data) {
        if (Utils.isDebugMode()) {
            aiDebugLog.push({ ts: Date.now(), label: label, data: data });
        }
    }
    
    function getAndClearAIDebugLog() {
        var log = aiDebugLog.slice();
        aiDebugLog = [];
        return log;
    }

    function callAI(prompt, options) {
        const aiConfig = getAIConfig();
        options = options || {};
        const startTime = Date.now();
        
        addAIDebug('callAI start', {
            promptLength: prompt?.length,
            promptPreview: (prompt || '').substring(0, 100),
            hasTools: !!(options.tools?.length),
            toolCount: options.tools?.length || 0,
            toolNames: options.tools?.map(t => t.name) || [],
            tier: options.tier,
            purpose: options.purpose
        });
        
        // Determine which model and provider to use based on tier
        // getModelForTier now returns { provider, model } to support mixed-provider tiers
        const tier = options.tier || 3; // Default to premium for backward compatibility
        const tierResult = getModelForTier(aiConfig.provider, tier, aiConfig);
        
        // Get effective model for dynamic max tokens calculation
        let effectiveModel = getModelName(aiConfig);
        if (tierResult && tierResult.model) {
            effectiveModel = tierResult.model;
        }
        
        // Build unified options with dynamic max tokens
        const unifiedOptions = {
            maxTokens: options.maxTokens || getMaxTokensForModel(effectiveModel, options.purpose),
            temperature: options.temperature !== undefined ? options.temperature : aiConfig.temperature,
            systemPrompt: options.systemPrompt || null,
            chatHistory: options.chatHistory || [],
            documents: options.documents || null,
            jsonMode: options.jsonMode || false,
            jsonSchema: options.jsonSchema || null, // JSON schema for structured output enforcement
            tools: options.tools || null,
            // Track if we had to strip tools due to lack of capability
            toolsStripped: false
        };
        
        // Use the provider and model from tier result (supports mixed providers)
        // Be explicit about provider detection - don't rely on falsy checks
        let effectiveProvider = aiConfig.provider;
        
        if (tierResult && typeof tierResult === 'object') {
            if (tierResult.provider && tierResult.provider !== '') {
                effectiveProvider = tierResult.provider;
            }
            if (tierResult.model && tierResult.model !== '') {
                effectiveModel = tierResult.model;
            }
        }
        
        addAIDebug('After tier resolution', {
            effectiveProvider: effectiveProvider,
            effectiveModel: effectiveModel,
            hasToolsInOptions: !!(unifiedOptions.tools?.length)
        });
        
        // Check if the model supports tool calling
        // If tools requested but model doesn't support, strip tools and rely on JSON fallback
        if (unifiedOptions.tools && unifiedOptions.tools.length > 0) {
            const supportsTools = ModelRegistry.hasCapability(effectiveModel, 'tools');
            addAIDebug('Tool capability check', {
                model: effectiveModel,
                supportsTools: supportsTools
            });
            if (!supportsTools) {
                log.debug('Model does not support tools, using JSON fallback', { 
                    model: effectiveModel, 
                    provider: effectiveProvider 
                });
                // Convert tool schema to JSON instruction in system prompt
                unifiedOptions.toolsStripped = true;
                const toolSchemas = unifiedOptions.tools.map(t => ({
                    name: t.name,
                    description: t.description,
                    parameters: t.parameters
                }));
                const jsonInstruction = `\n\nYou must respond with a JSON object. Use this schema:\n${JSON.stringify(toolSchemas[0].parameters, null, 2)}\n\nRespond ONLY with valid JSON, no markdown or explanation.`;
                unifiedOptions.systemPrompt = (unifiedOptions.systemPrompt || '') + jsonInstruction;
                unifiedOptions.jsonMode = true;
                unifiedOptions.tools = null;
            }
        }
        
        log.debug('Tier resolution', {
            tier: tier,
            mainProvider: aiConfig.provider,
            tierConfigEnabled: aiConfig.tierConfigEnabled,
            tierResult: JSON.stringify(tierResult),
            effectiveProvider: effectiveProvider,
            effectiveModel: effectiveModel
        });
        
        // Build call config with the effective provider's API key
        const callConfig = Object.assign({}, aiConfig);
        callConfig.provider = effectiveProvider;
        
        // Set the model for the effective provider
        switch (effectiveProvider) {
            case 'openai':
                callConfig.openaiModel = effectiveModel;
                break;
            case 'anthropic':
                callConfig.anthropicModel = effectiveModel;
                break;
            case 'gemini':
                callConfig.geminiModel = effectiveModel;
                break;
            case 'openrouter':
                callConfig.openrouterModel = effectiveModel;
                break;
            case 'grok':
                callConfig.grokModel = effectiveModel;
                break;
            case 'netsuite':
                callConfig.netsuiteModel = effectiveModel;
                break;
        }
        
        const purpose = options.purpose || 'AI request';
        const modelInfo = getModelDisplayInfo(effectiveModel);
        log.debug('AI Call Start', { 
            provider: effectiveProvider, 
            model: effectiveModel, 
            tier: tier,
            tierName: modelInfo.tierName,
            purpose: purpose,
            mixedProvider: effectiveProvider !== aiConfig.provider
        });
        
        let result;
        try {
            // Use the effective provider for the API call
            switch (effectiveProvider) {
                case 'openai':
                    result = callOpenAI(prompt, callConfig, unifiedOptions);
                    break;
                case 'anthropic':
                    result = callAnthropic(prompt, callConfig, unifiedOptions);
                    break;
                case 'gemini':
                    result = callGemini(prompt, callConfig, unifiedOptions);
                    break;
                case 'openrouter':
                    result = callOpenRouter(prompt, callConfig, unifiedOptions);
                    break;
                case 'grok':
                    result = callGrok(prompt, callConfig, unifiedOptions);
                    break;
                default:
                    result = callNetSuite(prompt, callConfig, unifiedOptions);
            }
            
            addAIDebug('Raw result from provider', {
                provider: effectiveProvider,
                resultType: typeof result,
                resultKeys: Object.keys(result || {}),
                hasText: !!(result?.text),
                textLength: result?.text?.length || 0,
                textPreview: (result?.text || '').substring(0, 200),
                type: result?.type,
                hasToolCalls: !!(result?.toolCalls),
                toolCallsLength: result?.toolCalls?.length || 0,
                toolCallNames: result?.toolCalls?.map(tc => tc.name) || []
            });
            
        } catch (e) {
            // Extract comprehensive error details for debugging
            const errorDetails = Utils.extractErrorDetails(e);
            
            addAIDebug('Exception in AI call', { 
                error: e.message,
                errorDetails: errorDetails
            });
            
            const duration = Date.now() - startTime;
            aiCallLog.push({ 
                purpose, 
                model: effectiveModel, 
                provider: effectiveProvider, 
                duration, 
                error: e.message,
                errorDetails: errorDetails,
                tier: tier 
            });
            throw e;
        }
        
        const duration = Date.now() - startTime;
        
        // Log the call
        aiCallLog.push({ 
            purpose, 
            model: effectiveModel, 
            provider: effectiveProvider, 
            duration,
            type: result?.type || 'text',
            tier: tier
        });
        
        log.debug('AI Call Complete', { provider: effectiveProvider, model: effectiveModel, duration: duration + 'ms' });
        
        // Handle null/undefined result
        if (!result) {
            log.error('AI provider returned null/undefined result', { provider: effectiveProvider, model: effectiveModel });
            return { 
                text: '', 
                type: 'error', 
                error: 'AI provider returned empty response',
                model: effectiveModel, 
                provider: effectiveProvider, 
                duration: duration, 
                _aiDebug: getAndClearAIDebugLog() 
            };
        }
        
        // Normalize response format
        if (typeof result === 'string') {
            addAIDebug('Returning string result', { length: result.length });
            return { text: result, type: 'text', model: effectiveModel, provider: effectiveProvider, duration: duration, _aiDebug: getAndClearAIDebugLog() };
        }
        
        // Extra safety check before setting properties (defensive against unexpected null from providers)
        if (!result || typeof result !== 'object') {
            log.error('AI result became invalid after provider call', { 
                resultType: typeof result, 
                provider: effectiveProvider, 
                model: effectiveModel 
            });
            return { 
                text: '', 
                type: 'error', 
                error: 'AI provider returned invalid response type: ' + typeof result,
                model: effectiveModel, 
                provider: effectiveProvider, 
                duration: duration, 
                _aiDebug: getAndClearAIDebugLog() 
            };
        }
        
        result.model = effectiveModel;
        result.provider = effectiveProvider;
        result.duration = duration;
        result._aiDebug = getAndClearAIDebugLog();
        return result;
    }
    
    /**
     * Get and clear the AI call log
     */
    function getAndClearAICallLog() {
        const logCopy = aiCallLog.slice();
        aiCallLog = [];
        return logCopy;
    }

    /**
     * Map JSON Schema type to llm.ToolParameterType enum
     */
    function mapToToolParameterType(jsonType) {
        // Use the actual enum values from llm.ToolParameterType
        if (!llm || !llm.ToolParameterType) {
            // Fallback to string constants if enum not available
            // Note: NetSuite uses FLOAT not NUMBER
            const fallbackMap = {
                'string': 'STRING',
                'number': 'FLOAT',   // NetSuite uses FLOAT
                'integer': 'INTEGER',
                'boolean': 'BOOLEAN',
                'array': 'ARRAY',
                'object': 'OBJECT'
            };
            return fallbackMap[jsonType] || 'STRING';
        }
        
        // Use the enum - NetSuite has FLOAT not NUMBER
        switch (jsonType) {
            case 'string': return llm.ToolParameterType.STRING;
            case 'number': return llm.ToolParameterType.FLOAT;  // FLOAT not NUMBER
            case 'integer': return llm.ToolParameterType.INTEGER;
            case 'boolean': return llm.ToolParameterType.BOOLEAN;
            case 'array': return llm.ToolParameterType.ARRAY;
            case 'object': return llm.ToolParameterType.OBJECT;
            default: return llm.ToolParameterType.STRING;
        }
    }

    /**
     * Call NetSuite built-in LLM (Cohere)
     * Supports: documents (RAG), chatHistory, preamble, tools
     * 
     * Tool calling via llm.Tool objects - format based on OCI Cohere CohereTool
     */
    function callNetSuite(prompt, aiConfig, options) {
        const modelFamily = getNetSuiteModelFamily(aiConfig.netsuiteModel);
        
        // Build prompt with history included (more reliable than chatHistory parameter)
        let fullPrompt = prompt;
        if (options.chatHistory && options.chatHistory.length > 0) {
            const historyText = Utils.formatChatHistoryAsText(options.chatHistory);
            if (historyText) {
                fullPrompt = historyText + '\n\nCurrent question:\n' + prompt;
            }
        }
        
        const params = {
            prompt: fullPrompt,
            modelFamily: modelFamily,
            modelParameters: {
                // Defensive: ensure maxTokens is a valid number, default to 4000
                maxTokens: Math.min(options.maxTokens || 4000, 4000),
                temperature: options.temperature || 0.3
            }
        };
        
        // RAG documents
        if (options.documents && options.documents.length > 0) {
            params.documents = options.documents;
        }
        
        // System prompt as preamble (Cohere feature)
        if (options.systemPrompt) {
            params.preamble = options.systemPrompt;
        }
        
        // ═══════════════════════════════════════════════════════════════
        // DIAGNOSTIC: Log N/llm module capabilities for tool discovery
        // This will be returned in the response for debugging
        // ═══════════════════════════════════════════════════════════════
        if (options.tools && options.tools.length > 0 && !_nllmDiscoveryInfo) {
            _nllmDiscoveryInfo = {
                timestamp: new Date().toISOString(),
                llmModuleType: typeof llm,
                llmModuleKeys: Object.keys(llm || {}),
                hasCreateTool: llm && typeof llm.createTool === 'function',
                hasCreateToolParameter: llm && typeof llm.createToolParameter === 'function',
                hasCreateToolResult: llm && typeof llm.createToolResult === 'function',
                hasToolParameterType: llm && !!llm.ToolParameterType,
                toolParameterTypes: llm && llm.ToolParameterType ? Object.keys(llm.ToolParameterType) : [],
                modelFamilyEnum: llm && llm.ModelFamily ? Object.keys(llm.ModelFamily) : [],
                chatRoleEnum: llm && llm.ChatRole ? Object.keys(llm.ChatRole) : []
            };
            log.audit('N/llm Tool Discovery', _nllmDiscoveryInfo);
        }
        
        // ═══════════════════════════════════════════════════════════════
        // TOOL CALLING: Use llm.createTool + llm.createToolParameter
        // ═══════════════════════════════════════════════════════════════
        if (options.tools && options.tools.length > 0) {
            // DEFENSIVE: Filter out any undefined tools to prevent "Cannot read property 'name' of undefined"
            const validTools = options.tools.filter(t => t && t.name);
            
            if (validTools.length === 0) {
                log.debug('No valid tools provided (all were undefined or missing name)', {
                    originalCount: options.tools.length
                });
            } else if (validTools.length < options.tools.length) {
                log.debug('Some tools were undefined and filtered out', {
                    originalCount: options.tools.length,
                    validCount: validTools.length
                });
            }
            
            // Verify required methods exist
            if (validTools.length > 0 && (typeof llm.createTool !== 'function' || typeof llm.createToolParameter !== 'function')) {
                log.debug('N/llm tool creation methods not available');
            } else if (validTools.length > 0) {
                try {
                    params.tools = validTools.map(tool => {
                        // Create parameters array using llm.createToolParameter
                        const toolParams = [];
                        
                        if (tool.parameters && tool.parameters.properties) {
                            const requiredParams = tool.parameters.required || [];
                            
                            for (const [paramName, paramDef] of Object.entries(tool.parameters.properties)) {
                                // Map JSON Schema type to llm.ToolParameterType
                                const paramType = mapToToolParameterType(paramDef.type);
                                
                                toolParams.push(llm.createToolParameter({
                                    name: paramName,
                                    description: paramDef.description || paramName,
                                    type: paramType,
                                    required: requiredParams.includes(paramName)
                                }));
                            }
                        }
                        
                        // Create the tool with parameters array
                        return llm.createTool({
                            name: tool.name,
                            description: tool.description,
                            parameters: toolParams
                        });
                    });
                    
                    log.debug('NetSuite tools created successfully', { 
                        toolCount: params.tools.length,
                        toolNames: validTools.map(t => t.name)
                    });
                    
                    if (_nllmDiscoveryInfo) {
                        _nllmDiscoveryInfo.toolsCreated = params.tools.length;
                        _nllmDiscoveryInfo.toolNames = validTools.map(t => t.name);
                    }
                    
                } catch (toolError) {
                    log.error('Failed to create NetSuite tools', { 
                        error: toolError.message,
                        stack: toolError.stack 
                    });
                    if (_nllmDiscoveryInfo) {
                        _nllmDiscoveryInfo.toolCreationError = toolError.message;
                    }
                    // Continue without tools
                    delete params.tools;
                }
            }
        }
        
        // Call the LLM with error capture
        let response;
        try {
            response = llm.generateText(params);
        } catch (llmError) {
            // Capture detailed error information from N/llm
            const errorDetails = Utils.extractErrorDetails(llmError);
            log.error('NetSuite LLM generateText failed', {
                modelFamily: modelFamily,
                promptLength: fullPrompt.length,
                errorDetails: errorDetails
            });
            
            // Re-throw with enhanced error message
            const enhancedError = new Error('NetSuite LLM error: ' + (llmError.message || 'Unknown error'));
            enhancedError.rawError = errorDetails;
            enhancedError.provider = 'netsuite';
            throw enhancedError;
        }
        
        // Handle null/undefined response from NetSuite LLM
        if (!response) {
            log.error('NetSuite LLM returned null/undefined response', { 
                modelFamily: modelFamily,
                promptLength: fullPrompt.length
            });
            return { 
                text: '', 
                type: 'error', 
                error: 'NetSuite LLM returned empty response'
            };
        }
        
        const text = response.text || '';
        
        // Log response structure for debugging
        if (_nllmDiscoveryInfo) {
            _nllmDiscoveryInfo.responseKeys = Object.keys(response || {});
            _nllmDiscoveryInfo.hasToolCalls = !!(response.toolCalls && response.toolCalls.length > 0);
        }
        
        // Check for tool calls in response
        if (response.toolCalls && response.toolCalls.length > 0) {
            log.debug('NetSuite returned tool calls', { 
                count: response.toolCalls.length,
                calls: response.toolCalls.map(tc => tc.name || tc.function?.name)
            });
            
            if (_nllmDiscoveryInfo) {
                _nllmDiscoveryInfo.toolCallsReturned = response.toolCalls.length;
                _nllmDiscoveryInfo.toolCallNames = response.toolCalls.map(tc => tc.name || tc.function?.name);
            }
            
            return {
                type: 'tool_call',
                toolCalls: response.toolCalls.map(tc => ({
                    name: tc.name || tc.function?.name,
                    arguments: tc.parameters || tc.arguments || tc.function?.arguments || {}
                })),
                text: text
            };
        }
        
        return { text: text, type: 'text' };
    }

    /**
     * Call OpenAI API
     * Supports: system message, chat history, JSON mode, function calling
     */
    function callOpenAI(prompt, aiConfig, options) {
        if (!aiConfig.openaiApiKey) {
            throw new Error('OpenAI API key not configured. Add your API key in Settings > AI Model Configuration.');
        }
        
        const messages = [];
        
        // System message (crucial for behavior)
        if (options.systemPrompt) {
            messages.push({ role: 'system', content: options.systemPrompt });
        }
        
        // Include RAG documents in system message if provided
        if (options.documents && options.documents.length > 0) {
            const docsContent = options.documents.map(d => d.data || d.content || '').join('\n\n---\n\n');
            if (messages.length > 0 && messages[0].role === 'system') {
                messages[0].content += '\n\nREFERENCE DOCUMENTS:\n' + docsContent;
            } else {
                messages.unshift({ role: 'system', content: 'REFERENCE DOCUMENTS:\n' + docsContent });
            }
        }
        
        // Conversation history
        if (options.chatHistory && options.chatHistory.length > 0) {
            options.chatHistory.forEach(msg => {
                if (msg && (msg.content || msg.text)) {
                    messages.push({
                        role: msg.role === 'user' ? 'user' : 'assistant',
                        content: msg.content || msg.text
                    });
                }
            });
        }
        
        // Current user prompt
        messages.push({ role: 'user', content: prompt });
        
        // Get the correct parameter name for max tokens based on model
        const maxTokensParam = ModelRegistry.getMaxTokensParam(aiConfig.openaiModel);
        
        const body = {
            model: aiConfig.openaiModel,
            messages: messages
        };
        
        // Only set temperature if model supports it (GPT-5 mini/nano don't)
        if (ModelRegistry.supportsTemperature(aiConfig.openaiModel)) {
            body.temperature = options.temperature;
        }
        
        // Set max tokens with correct parameter name
        body[maxTokensParam] = options.maxTokens;
        
        // JSON mode for structured responses
        // Prefer JSON schema enforcement when available for stricter output control
        if (options.jsonSchema) {
            body.response_format = {
                type: 'json_schema',
                json_schema: {
                    name: options.jsonSchema.name || 'response',
                    strict: true,
                    schema: options.jsonSchema.schema
                }
            };
        } else if (options.jsonMode) {
            body.response_format = { type: 'json_object' };
        }
        
        // Function calling
        if (options.tools && options.tools.length > 0) {
            body.tools = options.tools.map(tool => ({
                type: 'function',
                function: {
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.parameters
                }
            }));
            body.tool_choice = 'auto';
        }
        
        let response, data;
        try {
            response = https.post({
                url: 'https://api.openai.com/v1/chat/completions',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + aiConfig.openaiApiKey
                },
                body: JSON.stringify(body)
            });
            data = JSON.parse(response.body);
        } catch (httpError) {
            // Capture detailed error information from HTTP call
            const errorDetails = Utils.extractErrorDetails(httpError);
            errorDetails.responseCode = response?.code;
            errorDetails.responseBody = response?.body ? String(response.body).substring(0, 500) : null;
            
            log.error('OpenAI HTTP request failed', {
                model: aiConfig.openaiModel,
                errorDetails: errorDetails
            });
            
            const enhancedError = new Error('OpenAI HTTP error: ' + (httpError.message || 'Unknown error'));
            enhancedError.rawError = errorDetails;
            enhancedError.provider = 'openai';
            throw enhancedError;
        }
        
        // Debug: capture raw OpenAI response
        addAIDebug('OpenAI raw response', {
            hasError: !!data.error,
            errorMessage: data.error?.message,
            choicesCount: data.choices?.length || 0,
            firstChoiceKeys: Object.keys(data.choices?.[0] || {}),
            messageKeys: Object.keys(data.choices?.[0]?.message || {}),
            hasToolCalls: !!(data.choices?.[0]?.message?.tool_calls),
            toolCallsCount: data.choices?.[0]?.message?.tool_calls?.length || 0,
            contentLength: data.choices?.[0]?.message?.content?.length || 0,
            contentPreview: (data.choices?.[0]?.message?.content || '').substring(0, 200),
            finishReason: data.choices?.[0]?.finish_reason
        });
        
        if (data.error) {
            throw new Error('OpenAI error: ' + data.error.message);
        }
        
        const choice = data.choices?.[0];
        if (!choice) {
            throw new Error('OpenAI returned no response');
        }
        
        // Handle tool calls
        if (choice.message?.tool_calls && choice.message.tool_calls.length > 0) {
            return {
                type: 'tool_call',
                toolCalls: choice.message.tool_calls.map(tc => {
                    // Safely parse tool arguments - malformed JSON shouldn't crash
                    let parsedArgs = {};
                    try {
                        parsedArgs = JSON.parse(tc.function.arguments || '{}');
                    } catch (parseErr) {
                        log.error('Failed to parse OpenAI tool arguments', {
                            function: tc.function.name,
                            raw: (tc.function.arguments || '').substring(0, 200),
                            error: parseErr.message
                        });
                    }
                    return {
                        id: tc.id,
                        name: tc.function.name,
                        arguments: parsedArgs
                    };
                }),
                text: choice.message.content || ''
            };
        }
        
        return { text: choice.message?.content || '', type: 'text' };
    }

    /**
     * Call Anthropic API (Claude)
     * Supports: system parameter, chat history, tool use
     */
    function callAnthropic(prompt, aiConfig, options) {
        if (!aiConfig.anthropicApiKey) {
            throw new Error('Anthropic API key not configured. Add your API key in Settings > AI Model Configuration.');
        }
        
        const messages = [];
        
        // Conversation history
        if (options.chatHistory && options.chatHistory.length > 0) {
            options.chatHistory.forEach(msg => {
                if (msg && (msg.content || msg.text)) {
                    messages.push({
                        role: msg.role === 'user' ? 'user' : 'assistant',
                        content: msg.content || msg.text
                    });
                }
            });
        }
        
        // Current user prompt
        messages.push({ role: 'user', content: prompt });
        
        const body = {
            model: aiConfig.anthropicModel,
            max_tokens: options.maxTokens,
            messages: messages
        };
        
        // Temperature (but not for extended thinking)
        if (options.temperature !== undefined) {
            body.temperature = options.temperature;
        }
        
        // System prompt (Claude's strongest feature)
        let systemContent = options.systemPrompt || '';
        
        // Include RAG documents in system prompt
        if (options.documents && options.documents.length > 0) {
            const docsContent = options.documents.map(d => d.data || d.content || '').join('\n\n---\n\n');
            systemContent += (systemContent ? '\n\n' : '') + 'REFERENCE DOCUMENTS:\n' + docsContent;
        }
        
        if (systemContent) {
            body.system = systemContent;
        }
        
        // Tool use
        if (options.tools && options.tools.length > 0) {
            body.tools = options.tools.map(tool => ({
                name: tool.name,
                description: tool.description,
                input_schema: tool.parameters
            }));
        }
        
        let response, data;
        try {
            response = https.post({
                url: 'https://api.anthropic.com/v1/messages',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': aiConfig.anthropicApiKey,
                    'anthropic-version': '2023-06-01'
                },
                body: JSON.stringify(body)
            });
            data = JSON.parse(response.body);
        } catch (httpError) {
            // Capture detailed error information from HTTP call
            const errorDetails = Utils.extractErrorDetails(httpError);
            errorDetails.responseCode = response?.code;
            errorDetails.responseBody = response?.body ? String(response.body).substring(0, 500) : null;
            
            log.error('Anthropic HTTP request failed', {
                model: aiConfig.anthropicModel,
                errorDetails: errorDetails
            });
            
            const enhancedError = new Error('Anthropic HTTP error: ' + (httpError.message || 'Unknown error'));
            enhancedError.rawError = errorDetails;
            enhancedError.provider = 'anthropic';
            throw enhancedError;
        }
        if (data.error) {
            throw new Error('Anthropic error: ' + (data.error.message || JSON.stringify(data.error)));
        }
        
        // Handle tool use responses
        if (data.stop_reason === 'tool_use') {
            const toolUses = data.content.filter(c => c.type === 'tool_use');
            const textContent = data.content.find(c => c.type === 'text');
            
            return {
                type: 'tool_call',
                toolCalls: toolUses.map(tu => ({
                    id: tu.id,
                    name: tu.name,
                    arguments: tu.input
                })),
                text: textContent?.text || ''
            };
        }
        
        // Extract text response
        const textContent = data.content?.find(c => c.type === 'text');
        return { text: textContent?.text || '', type: 'text' };
    }

    /**
     * Call Google Gemini API
     * Supports: system instruction, multi-turn conversation, function calling, JSON mode
     */
    function callGemini(prompt, aiConfig, options) {
        if (!aiConfig.geminiApiKey) {
            throw new Error('Gemini API key not configured. Add your API key in Settings > AI Model Configuration.');
        }
        
        const contents = [];
        
        // Conversation history
        if (options.chatHistory && options.chatHistory.length > 0) {
            options.chatHistory.forEach(msg => {
                if (msg && (msg.content || msg.text)) {
                    contents.push({
                        role: msg.role === 'user' ? 'user' : 'model',
                        parts: [{ text: msg.content || msg.text }]
                    });
                }
            });
        }
        
        // Current user prompt
        contents.push({
            role: 'user',
            parts: [{ text: prompt }]
        });
        
        const body = {
            contents: contents,
            generationConfig: {
                maxOutputTokens: options.maxTokens,
                temperature: options.temperature
            }
        };
        
        // System instruction
        let systemContent = options.systemPrompt || '';
        
        // Include RAG documents in system instruction
        if (options.documents && options.documents.length > 0) {
            const docsContent = options.documents.map(d => d.data || d.content || '').join('\n\n---\n\n');
            systemContent += (systemContent ? '\n\n' : '') + 'REFERENCE DOCUMENTS:\n' + docsContent;
        }
        
        if (systemContent) {
            body.systemInstruction = {
                parts: [{ text: systemContent }]
            };
        }
        
        // JSON mode with optional schema enforcement
        // Gemini supports responseSchema for structured output control
        if (options.jsonSchema) {
            body.generationConfig.responseMimeType = 'application/json';
            body.generationConfig.responseSchema = options.jsonSchema.schema;
        } else if (options.jsonMode) {
            body.generationConfig.responseMimeType = 'application/json';
        }
        
        // Function calling
        if (options.tools && options.tools.length > 0) {
            body.tools = [{
                functionDeclarations: options.tools.map(tool => ({
                    name: tool.name,
                    description: tool.description,
                    parameters: sanitizeParametersForGemini(tool.parameters)
                }))
            }];
        }
        
        let response, data;
        try {
            response = https.post({
                url: 'https://generativelanguage.googleapis.com/v1beta/models/' + 
                     aiConfig.geminiModel + ':generateContent?key=' + aiConfig.geminiApiKey,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            data = JSON.parse(response.body);
        } catch (httpError) {
            // Capture detailed error information from HTTP call
            const errorDetails = Utils.extractErrorDetails(httpError);
            errorDetails.responseCode = response?.code;
            errorDetails.responseBody = response?.body ? String(response.body).substring(0, 500) : null;
            
            log.error('Gemini HTTP request failed', {
                model: aiConfig.geminiModel,
                errorDetails: errorDetails
            });
            
            const enhancedError = new Error('Gemini HTTP error: ' + (httpError.message || 'Unknown error'));
            enhancedError.rawError = errorDetails;
            enhancedError.provider = 'gemini';
            throw enhancedError;
        }
        if (data.error) {
            throw new Error('Gemini error: ' + (data.error.message || JSON.stringify(data.error)));
        }
        
        const candidate = data.candidates?.[0];
        if (!candidate) {
            throw new Error('Gemini returned no response');
        }
        
        // Handle function calls
        const functionCall = candidate.content?.parts?.find(p => p.functionCall);
        if (functionCall) {
            return {
                type: 'tool_call',
                toolCalls: [{
                    name: functionCall.functionCall.name,
                    arguments: functionCall.functionCall.args || {}
                }],
                text: ''
            };
        }
        
        const textPart = candidate.content?.parts?.find(p => p.text);
        return { text: textPart?.text || '', type: 'text' };
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // OPENROUTER PROVIDER
    // Access to 100+ models (Claude, Llama, Mistral, Qwen, DeepSeek, etc.)
    // via a single API key. OpenAI-compatible API.
    // ═══════════════════════════════════════════════════════════════════════════
    function callOpenRouter(prompt, aiConfig, options) {
        if (!aiConfig.openrouterApiKey) {
            throw new Error('OpenRouter API key not configured. Add your API key in Settings > API Keys.');
        }
        
        const messages = [];
        
        // System message
        if (options.systemPrompt) {
            messages.push({ role: 'system', content: options.systemPrompt });
        }
        
        // Include RAG documents in system message if provided
        if (options.documents && options.documents.length > 0) {
            const docsContent = options.documents.map(d => d.data || d.content || '').join('\n\n---\n\n');
            if (messages.length > 0 && messages[0].role === 'system') {
                messages[0].content += '\n\nREFERENCE DOCUMENTS:\n' + docsContent;
            } else {
                messages.unshift({ role: 'system', content: 'REFERENCE DOCUMENTS:\n' + docsContent });
            }
        }
        
        // Conversation history
        if (options.chatHistory && options.chatHistory.length > 0) {
            options.chatHistory.forEach(msg => {
                if (msg && (msg.content || msg.text)) {
                    messages.push({
                        role: msg.role === 'user' ? 'user' : 'assistant',
                        content: msg.content || msg.text
                    });
                }
            });
        }
        
        // Current user prompt
        messages.push({ role: 'user', content: prompt });
        
        const body = {
            model: aiConfig.openrouterModel,
            messages: messages,
            temperature: options.temperature,
            max_tokens: options.maxTokens
        };
        
        // JSON mode with optional schema enforcement (OpenAI-compatible)
        if (options.jsonSchema) {
            body.response_format = {
                type: 'json_schema',
                json_schema: {
                    name: options.jsonSchema.name || 'response',
                    strict: true,
                    schema: options.jsonSchema.schema
                }
            };
        } else if (options.jsonMode) {
            body.response_format = { type: 'json_object' };
        }

        // Function calling (OpenAI-compatible format)
        if (options.tools && options.tools.length > 0) {
            body.tools = options.tools.map(tool => ({
                type: 'function',
                function: {
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.parameters
                }
            }));
            body.tool_choice = 'auto';
        }
        
        let response, data;
        try {
            response = https.post({
                url: 'https://openrouter.ai/api/v1/chat/completions',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + aiConfig.openrouterApiKey,
                    'HTTP-Referer': 'https://gantry.finance',
                    'X-Title': 'Gantry Finance Advisor'
                },
                body: JSON.stringify(body)
            });
            data = JSON.parse(response.body);
        } catch (httpError) {
            const errorDetails = Utils.extractErrorDetails(httpError);
            errorDetails.responseCode = response?.code;
            errorDetails.responseBody = response?.body ? String(response.body).substring(0, 500) : null;
            
            log.error('OpenRouter HTTP request failed', {
                model: aiConfig.openrouterModel,
                errorDetails: errorDetails
            });
            
            const enhancedError = new Error('OpenRouter HTTP error: ' + (httpError.message || 'Unknown error'));
            enhancedError.rawError = errorDetails;
            enhancedError.provider = 'openrouter';
            throw enhancedError;
        }
        
        if (data.error) {
            throw new Error('OpenRouter error: ' + (data.error.message || JSON.stringify(data.error)));
        }
        
        const choice = data.choices?.[0];
        if (!choice) {
            throw new Error('OpenRouter returned no response');
        }
        
        // Handle tool calls
        if (choice.message?.tool_calls && choice.message.tool_calls.length > 0) {
            return {
                type: 'tool_call',
                toolCalls: choice.message.tool_calls.map(tc => ({
                    name: tc.function?.name,
                    arguments: tc.function?.arguments ? 
                        (typeof tc.function.arguments === 'string' ? 
                            JSON.parse(tc.function.arguments) : tc.function.arguments) : {}
                })),
                text: choice.message.content || ''
            };
        }
        
        return { 
            text: choice.message?.content || '', 
            type: 'text',
            model: data.model // OpenRouter returns actual model used
        };
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // GROK PROVIDER (xAI)
    // xAI's Grok model with real-time knowledge and web access.
    // OpenAI-compatible API at api.x.ai
    // ═══════════════════════════════════════════════════════════════════════════
    function callGrok(prompt, aiConfig, options) {
        if (!aiConfig.grokApiKey) {
            throw new Error('Grok API key not configured. Add your xAI API key in Settings > API Keys.');
        }
        
        const messages = [];
        
        // System message
        if (options.systemPrompt) {
            messages.push({ role: 'system', content: options.systemPrompt });
        }
        
        // Include RAG documents in system message if provided
        if (options.documents && options.documents.length > 0) {
            const docsContent = options.documents.map(d => d.data || d.content || '').join('\n\n---\n\n');
            if (messages.length > 0 && messages[0].role === 'system') {
                messages[0].content += '\n\nREFERENCE DOCUMENTS:\n' + docsContent;
            } else {
                messages.unshift({ role: 'system', content: 'REFERENCE DOCUMENTS:\n' + docsContent });
            }
        }
        
        // Conversation history
        if (options.chatHistory && options.chatHistory.length > 0) {
            options.chatHistory.forEach(msg => {
                if (msg && (msg.content || msg.text)) {
                    messages.push({
                        role: msg.role === 'user' ? 'user' : 'assistant',
                        content: msg.content || msg.text
                    });
                }
            });
        }
        
        // Current user prompt
        messages.push({ role: 'user', content: prompt });
        
        const body = {
            model: aiConfig.grokModel,
            messages: messages,
            temperature: options.temperature,
            max_tokens: options.maxTokens
        };

        // JSON mode with optional schema enforcement (OpenAI-compatible)
        if (options.jsonSchema) {
            body.response_format = {
                type: 'json_schema',
                json_schema: {
                    name: options.jsonSchema.name || 'response',
                    strict: true,
                    schema: options.jsonSchema.schema
                }
            };
        } else if (options.jsonMode) {
            body.response_format = { type: 'json_object' };
        }

        // Function calling (xAI supports OpenAI-compatible tool calling)
        if (options.tools && options.tools.length > 0) {
            body.tools = options.tools.map(tool => ({
                type: 'function',
                function: {
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.parameters
                }
            }));
            body.tool_choice = 'auto';
        }
        
        let response, data;
        try {
            response = https.post({
                url: 'https://api.x.ai/v1/chat/completions',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + aiConfig.grokApiKey
                },
                body: JSON.stringify(body)
            });
            data = JSON.parse(response.body);
        } catch (httpError) {
            const errorDetails = Utils.extractErrorDetails(httpError);
            errorDetails.responseCode = response?.code;
            errorDetails.responseBody = response?.body ? String(response.body).substring(0, 500) : null;
            
            log.error('Grok HTTP request failed', {
                model: aiConfig.grokModel,
                errorDetails: errorDetails
            });
            
            const enhancedError = new Error('Grok HTTP error: ' + (httpError.message || 'Unknown error'));
            enhancedError.rawError = errorDetails;
            enhancedError.provider = 'grok';
            throw enhancedError;
        }
        
        if (data.error) {
            throw new Error('Grok error: ' + (data.error.message || JSON.stringify(data.error)));
        }
        
        const choice = data.choices?.[0];
        if (!choice) {
            throw new Error('Grok returned no response');
        }
        
        // Handle tool calls
        if (choice.message?.tool_calls && choice.message.tool_calls.length > 0) {
            return {
                type: 'tool_call',
                toolCalls: choice.message.tool_calls.map(tc => ({
                    name: tc.function?.name,
                    arguments: tc.function?.arguments ? 
                        (typeof tc.function.arguments === 'string' ? 
                            JSON.parse(tc.function.arguments) : tc.function.arguments) : {}
                })),
                text: choice.message.content || ''
            };
        }
        
        return { 
            text: choice.message?.content || '', 
            type: 'text',
            usage: data.usage
        };
    }

    /**
     * Get current AI config for response
     */
    function getCurrentModelInfo() {
        const aiConfig = getAIConfig();
        return {
            provider: aiConfig.provider,
            model: getModelName(aiConfig)
        };
    }

    /**
     * Get NetSuite AI usage statistics
     */
    function getUsage() {
        try {
            let generateRemaining = 0;
            try {
                generateRemaining = llm.getRemainingFreeUsage() || 0;
            } catch (e) {
                log.debug('Could not get generate usage', e.message);
            }
            
            let embedRemaining = 0;
            try {
                embedRemaining = llm.getRemainingFreeEmbedUsage() || 0;
            } catch (e) {
                log.debug('Could not get embed usage', e.message);
            }
            
            // NetSuite free tier is 20,000 per month for each
            // If remaining is higher, use that as the total (account may have higher limits)
            const generateTotal = Math.max(20000, generateRemaining);
            const embedTotal = Math.max(20000, embedRemaining);
            
            return {
                generate: {
                    remaining: generateRemaining,
                    total: generateTotal,
                    used: generateTotal - generateRemaining,
                    pct: Math.round(((generateTotal - generateRemaining) / generateTotal) * 100)
                },
                embed: {
                    remaining: embedRemaining,
                    total: embedTotal,
                    used: embedTotal - embedRemaining,
                    pct: Math.round(((embedTotal - embedRemaining) / embedTotal) * 100)
                }
            };
        } catch (e) {
            log.error('AI Usage Error', e.message);
            return { error: e.message };
        }
    }

    return {
        // Main interface
        callAI: callAI,
        getAIConfig: getAIConfig,
        getCurrentModelInfo: getCurrentModelInfo,
        getModelName: getModelName,
        getUsage: getUsage,
        
        // Model utilities
        getMaxTokensForModel: getMaxTokensForModel,
        getModelForTier: getModelForTier,
        getModelDisplayInfo: getModelDisplayInfo,
        
        // Call log
        getAndClearAICallLog: getAndClearAICallLog,
        
        // Debug
        getAndClearAIDebugLog: getAndClearAIDebugLog
    };
});