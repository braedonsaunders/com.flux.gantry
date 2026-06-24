/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * 
 * Lib_Model_Registry.js
 * Centralized registry of AI models with provider-specific configurations
 * 
 * Single source of truth for:
 * - Model IDs and display names
 * - Pricing information
 * - API parameter mappings (max_tokens vs max_completion_tokens)
 * - Tier classifications (fast/balanced/premium)
 * - Capability flags
 * - OpenRouter dynamic model support
 */
define(['N/log', 'N/https', 'N/cache', './advisor/Lib_Advisor_Utils'], function(log, https, cache, Utils) {
    'use strict';

    // Cache for OpenRouter models (5 minute TTL)
    const OPENROUTER_CACHE_KEY = 'openrouter_models';
    const OPENROUTER_CACHE_TTL = 300; // 5 minutes
    
    /**
     * Provider configurations
     */
    const PROVIDERS = {
        openai: {
            id: 'openai',
            name: 'OpenAI',
            baseUrl: 'https://api.openai.com/v1/chat/completions',
            authHeader: 'Authorization',
            authPrefix: 'Bearer ',
            parameterMappings: {
                'gpt-5': { maxTokensParam: 'max_completion_tokens' },
                'gpt-5.1': { maxTokensParam: 'max_completion_tokens' },
                'gpt-5-mini': { maxTokensParam: 'max_completion_tokens' },
                'gpt-5-nano': { maxTokensParam: 'max_completion_tokens' },
                'gpt-4': { maxTokensParam: 'max_tokens' },
                'gpt-4o': { maxTokensParam: 'max_tokens' },
                'gpt-4.1': { maxTokensParam: 'max_tokens' },
                'gpt-4.1-mini': { maxTokensParam: 'max_tokens' },
                'gpt-4.1-nano': { maxTokensParam: 'max_tokens' },
                'o3': { maxTokensParam: 'max_completion_tokens' },
                'o4-mini': { maxTokensParam: 'max_completion_tokens' }
            },
            defaultMaxTokensParam: 'max_tokens'
        },
        anthropic: {
            id: 'anthropic',
            name: 'Anthropic',
            baseUrl: 'https://api.anthropic.com/v1/messages',
            authHeader: 'x-api-key',
            authPrefix: '',
            apiVersion: '2023-06-01',
            parameterMappings: {
                'default': { maxTokensParam: 'max_tokens' }
            },
            defaultMaxTokensParam: 'max_tokens'
        },
        gemini: {
            id: 'gemini',
            name: 'Google Gemini',
            baseUrl: 'https://generativelanguage.googleapis.com/v1beta/models/',
            authMethod: 'query',
            parameterMappings: {
                'default': { maxTokensParam: 'maxOutputTokens', wrapper: 'generationConfig' }
            },
            defaultMaxTokensParam: 'maxOutputTokens'
        },
        openrouter: {
            id: 'openrouter',
            name: 'OpenRouter',
            baseUrl: 'https://openrouter.ai/api/v1/chat/completions',
            modelsUrl: 'https://openrouter.ai/api/v1/models',
            authHeader: 'Authorization',
            authPrefix: 'Bearer ',
            parameterMappings: {
                'default': { maxTokensParam: 'max_tokens' }
            },
            defaultMaxTokensParam: 'max_tokens',
            // OpenRouter uses OpenAI-compatible format
            dynamicModels: true
        },
        grok: {
            id: 'grok',
            name: 'xAI Grok',
            baseUrl: 'https://api.x.ai/v1/chat/completions',
            authHeader: 'Authorization',
            authPrefix: 'Bearer ',
            parameterMappings: {
                'default': { maxTokensParam: 'max_tokens' }
            },
            defaultMaxTokensParam: 'max_tokens'
        },
        netsuite: {
            id: 'netsuite',
            name: 'NetSuite AI',
            parameterMappings: {
                'default': { maxTokensParam: 'maxTokens', wrapper: 'modelParameters' }
            },
            defaultMaxTokensParam: 'maxTokens'
        }
    };

    /**
     * Model definitions - Static models for known providers
     */
    const MODELS = {
        // ==========================================
        // OPENAI MODELS
        // ==========================================
        'gpt-5.1': {
            id: 'gpt-5.1',
            provider: 'openai',
            name: 'GPT-5.1',
            description: 'Latest & Best - Smarter, more conversational',
            tier: 3,
            pricing: { input: 1.25, output: 10 },
            contextWindow: 272000,
            maxOutput: 128000,
            capabilities: ['text', 'vision', 'tools', 'json_mode'],
            supportsTemperature: true,
            recommended: true,
            settingsLabel: 'GPT-5.1 (Recommended - Latest & Best)'
        },
        'gpt-5': {
            id: 'gpt-5',
            provider: 'openai',
            name: 'GPT-5',
            description: 'Premium unified model with adaptive reasoning',
            tier: 3,
            pricing: { input: 1.25, output: 10 },
            contextWindow: 272000,
            maxOutput: 128000,
            capabilities: ['text', 'vision', 'tools', 'json_mode'],
            supportsTemperature: true,
            settingsLabel: 'GPT-5 (Premium)'
        },
        'gpt-5-mini': {
            id: 'gpt-5-mini',
            provider: 'openai',
            name: 'GPT-5 Mini',
            description: 'Balanced - Good performance at lower cost',
            tier: 2,
            pricing: { input: 0.25, output: 2 },
            contextWindow: 272000,
            maxOutput: 128000,
            capabilities: ['text', 'vision', 'tools', 'json_mode'],
            supportsTemperature: false,
            settingsLabel: 'GPT-5 Mini (Balanced)'
        },
        'gpt-5-nano': {
            id: 'gpt-5-nano',
            provider: 'openai',
            name: 'GPT-5 Nano',
            description: 'Fastest & Cheapest - Great for simple tasks',
            tier: 1,
            pricing: { input: 0.05, output: 0.40 },
            contextWindow: 272000,
            maxOutput: 128000,
            capabilities: ['text', 'vision', 'tools', 'json_mode'],
            supportsTemperature: false,
            settingsLabel: 'GPT-5 Nano (Fastest)'
        },
        'gpt-4.1': {
            id: 'gpt-4.1',
            provider: 'openai',
            name: 'GPT-4.1',
            description: 'Legacy - Still excellent for coding',
            tier: 3,
            pricing: { input: 2.50, output: 10 },
            contextWindow: 128000,
            maxOutput: 16384,
            capabilities: ['text', 'vision', 'tools', 'json_mode'],
            supportsTemperature: true,
            legacy: true,
            settingsLabel: 'GPT-4.1 (Legacy)'
        },
        'gpt-4o': {
            id: 'gpt-4o',
            provider: 'openai',
            name: 'GPT-4o',
            description: 'Legacy Multimodal',
            tier: 3,
            pricing: { input: 2.50, output: 10 },
            contextWindow: 128000,
            maxOutput: 16384,
            capabilities: ['text', 'vision', 'audio', 'tools', 'json_mode'],
            supportsTemperature: true,
            legacy: true,
            settingsLabel: 'GPT-4o (Legacy Multimodal)'
        },

        // ==========================================
        // ANTHROPIC MODELS
        // ==========================================
        'claude-opus-4-8': {
            id: 'claude-opus-4-8',
            provider: 'anthropic',
            name: 'Claude Opus 4.8',
            description: 'Most capable - state-of-the-art reasoning and agentic work',
            tier: 3,
            pricing: { input: 5, output: 25 },
            contextWindow: 1000000,
            maxOutput: 8192,
            capabilities: ['text', 'vision', 'tools', 'json_mode', 'thinking', 'effort'],
            settingsLabel: 'Claude Opus 4.8 (Premium - Most Capable)'
        },
        'claude-sonnet-4-6': {
            id: 'claude-sonnet-4-6',
            provider: 'anthropic',
            name: 'Claude Sonnet 4.6',
            description: 'Recommended - best balance of speed and intelligence',
            tier: 2,
            pricing: { input: 3, output: 15 },
            contextWindow: 1000000,
            maxOutput: 8192,
            capabilities: ['text', 'vision', 'tools', 'json_mode', 'thinking', 'effort'],
            recommended: true,
            settingsLabel: 'Claude Sonnet 4.6 (Recommended - Balanced)'
        },
        'claude-haiku-4-5': {
            id: 'claude-haiku-4-5',
            provider: 'anthropic',
            name: 'Claude Haiku 4.5',
            description: 'Fastest - near-frontier at a fraction of the cost',
            tier: 1,
            pricing: { input: 1, output: 5 },
            contextWindow: 200000,
            maxOutput: 8192,
            capabilities: ['text', 'vision', 'tools', 'json_mode'],
            settingsLabel: 'Claude Haiku 4.5 (Fastest)'
        },

        // ==========================================
        // GEMINI MODELS
        // ==========================================
        'gemini-3-pro-preview': {
            id: 'gemini-3-pro-preview',
            provider: 'gemini',
            name: 'Gemini 3 Pro',
            description: 'Latest - Most intelligent with Deep Think',
            tier: 3,
            pricing: { input: 2, output: 12 },
            contextWindow: 1000000,
            maxOutput: 64000,
            capabilities: ['text', 'vision', 'audio', 'video', 'tools', 'json_mode', 'code_execution'],
            preview: true,
            settingsLabel: 'Gemini 3 Pro (Latest - Most Intelligent)'
        },
        'gemini-2.5-pro': {
            id: 'gemini-2.5-pro',
            provider: 'gemini',
            name: 'Gemini 2.5 Pro',
            description: 'Premium - Complex reasoning and coding',
            tier: 3,
            pricing: { input: 1.25, output: 5 },
            contextWindow: 1000000,
            maxOutput: 65536,
            capabilities: ['text', 'vision', 'audio', 'video', 'tools', 'json_mode', 'code_execution'],
            settingsLabel: 'Gemini 2.5 Pro (Premium - Complex Reasoning)'
        },
        'gemini-2.5-flash': {
            id: 'gemini-2.5-flash',
            provider: 'gemini',
            name: 'Gemini 2.5 Flash',
            description: 'Recommended - Fast thinking with great results',
            tier: 2,
            pricing: { input: 0.15, output: 0.60 },
            contextWindow: 1000000,
            maxOutput: 65536,
            capabilities: ['text', 'vision', 'audio', 'video', 'tools', 'json_mode', 'code_execution'],
            recommended: true,
            settingsLabel: 'Gemini 2.5 Flash (Recommended - Fast & Smart)'
        },
        'gemini-2.5-flash-lite': {
            id: 'gemini-2.5-flash-lite',
            provider: 'gemini',
            name: 'Gemini 2.5 Flash-Lite',
            description: 'Fastest & Cheapest - Great for high volume',
            tier: 1,
            pricing: { input: 0.075, output: 0.30 },
            contextWindow: 1000000,
            maxOutput: 65536,
            capabilities: ['text', 'vision', 'tools', 'json_mode'],
            settingsLabel: 'Gemini 2.5 Flash-Lite (Fastest & Cheapest)'
        },

        // ==========================================
        // GROK MODELS
        // ==========================================
        'grok-3': {
            id: 'grok-3',
            provider: 'grok',
            name: 'Grok 3',
            description: 'Latest xAI model with real-time knowledge',
            tier: 3,
            pricing: { input: 3, output: 15 },
            contextWindow: 131072,
            maxOutput: 8192,
            capabilities: ['text', 'tools', 'json_mode'],
            recommended: true,
            settingsLabel: 'Grok 3 (Latest - Real-time Knowledge)'
        },
        'grok-3-mini': {
            id: 'grok-3-mini',
            provider: 'grok',
            name: 'Grok 3 Mini',
            description: 'Fast reasoning model',
            tier: 1,
            pricing: { input: 0.30, output: 0.50 },
            contextWindow: 131072,
            maxOutput: 8192,
            capabilities: ['text', 'tools', 'json_mode'],
            settingsLabel: 'Grok 3 Mini (Fast)'
        },

        // ==========================================
        // NETSUITE MODELS
        // ==========================================
        'cohere-command-a': {
            id: 'cohere-command-a',
            provider: 'netsuite',
            name: 'Cohere Command A',
            description: 'Included with NetSuite - No API key needed',
            tier: 2,
            pricing: { input: 0, output: 0 },
            contextWindow: 128000,
            maxOutput: 4000,
            capabilities: ['text', 'rag', 'tools'],
            recommended: true,
            settingsLabel: 'Cohere Command A (Recommended - Included)',
            modelFamily: 'COHERE_COMMAND_A'
        },
        'cohere-command-r-plus': {
            id: 'cohere-command-r-plus',
            provider: 'netsuite',
            name: 'Cohere Command R+',
            description: 'Enhanced reasoning',
            tier: 3,
            pricing: { input: 0, output: 0 },
            contextWindow: 128000,
            maxOutput: 4000,
            capabilities: ['text', 'rag', 'tools'],
            settingsLabel: 'Cohere Command R+ (Enhanced)',
            modelFamily: 'COHERE_COMMAND_R_PLUS'
        },
        'cohere-command-r': {
            id: 'cohere-command-r',
            provider: 'netsuite',
            name: 'Cohere Command R',
            description: 'Fast and efficient',
            tier: 1,
            pricing: { input: 0, output: 0 },
            contextWindow: 128000,
            maxOutput: 4000,
            capabilities: ['text', 'rag', 'tools'],
            settingsLabel: 'Cohere Command R (Fast)',
            modelFamily: 'COHERE_COMMAND_R'
        },
        'meta-llama3': {
            id: 'meta-llama3',
            provider: 'netsuite',
            name: 'Meta Llama 3',
            description: 'Open source alternative',
            tier: 2,
            pricing: { input: 0, output: 0 },
            contextWindow: 8000,
            maxOutput: 4000,
            capabilities: ['text'],
            settingsLabel: 'Meta Llama 3',
            modelFamily: 'META_LLAMA3'
        }
    };

    /**
     * Tier definitions with models per provider
     */
    const TIERS = {
        openai: {
            1: 'gpt-5-nano',
            2: 'gpt-5-mini',
            3: 'gpt-5.1'
        },
        anthropic: {
            1: 'claude-haiku-4-5',
            2: 'claude-sonnet-4-6',
            3: 'claude-opus-4-8'
        },
        gemini: {
            1: 'gemini-2.5-flash-lite',
            2: 'gemini-2.5-flash',
            3: 'gemini-2.5-pro'
        },
        grok: {
            1: 'grok-3-mini',
            2: 'grok-3',
            3: 'grok-3'
        },
        openrouter: {
            // For OpenRouter, tiers are determined by pricing
            1: null, // Will use cheapest available
            2: null, // Will use medium-priced
            3: null  // Will use selected model
        },
        netsuite: {
            1: null,
            2: null,
            3: null
        }
    };

    // ==========================================
    // OPENROUTER DYNAMIC MODEL SUPPORT
    // ==========================================
    
    /**
     * Curated list of popular/recommended OpenRouter models
     * Only includes models that support tool calling
     */
    const OPENROUTER_CURATED_MODELS = {
        'anthropic': [
            { id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4', tier: 3 },
            { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', tier: 3 },
            { id: 'anthropic/claude-3.5-haiku', name: 'Claude 3.5 Haiku', tier: 1 }
        ],
        'openai': [
            { id: 'openai/gpt-4o', name: 'GPT-4o', tier: 3 },
            { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini', tier: 2 },
            { id: 'openai/gpt-4-turbo', name: 'GPT-4 Turbo', tier: 3 }
            // Note: o1/o1-preview excluded - reasoning models don't support tools
        ],
        'google': [
            { id: 'google/gemini-2.0-flash-001', name: 'Gemini 2.0 Flash', tier: 2 },
            { id: 'google/gemini-pro-1.5', name: 'Gemini Pro 1.5', tier: 3 }
        ],
        'meta': [
            { id: 'meta-llama/llama-3.3-70b-instruct', name: 'Llama 3.3 70B', tier: 2 },
            { id: 'meta-llama/llama-3.1-70b-instruct', name: 'Llama 3.1 70B', tier: 2 }
        ],
        'mistral': [
            { id: 'mistralai/mistral-large-2411', name: 'Mistral Large', tier: 3 },
            { id: 'mistralai/mistral-small-2503', name: 'Mistral Small', tier: 1 }
        ],
        'qwen': [
            { id: 'qwen/qwen-2.5-72b-instruct', name: 'Qwen 2.5 72B', tier: 2 },
            { id: 'qwen/qwen-2.5-32b-instruct', name: 'Qwen 2.5 32B', tier: 2 }
            // Note: QwQ excluded - reasoning model doesn't support tools
        ]
        // Note: DeepSeek R1 excluded - reasoning models don't support tools
    };

    /**
     * Fetch OpenRouter models from their API
     * @param {string} apiKey - OpenRouter API key
     * @returns {Array} List of available models
     */
    function fetchOpenRouterModels(apiKey) {
        if (!apiKey) {
            Utils.debugLog('No OpenRouter API key provided, returning curated list');
            return getCuratedOpenRouterModels();
        }
        
        try {
            // Try to get from cache first
            const modelCache = cache.getCache({
                name: 'GantryOpenRouterModels',
                scope: cache.Scope.PROTECTED
            });
            
            const cached = modelCache.get({ key: OPENROUTER_CACHE_KEY });
            if (cached) {
                try {
                    return JSON.parse(cached);
                } catch (e) {
                    Utils.debugLog('Cache parse error, fetching fresh');
                }
            }
            
            // Fetch from OpenRouter API
            const response = https.get({
                url: 'https://openrouter.ai/api/v1/models',
                headers: {
                    'Authorization': 'Bearer ' + apiKey,
                    'Content-Type': 'application/json'
                }
            });
            
            if (response.code !== 200) {
                log.error('OpenRouter API error', { code: response.code, body: response.body });
                return getCuratedOpenRouterModels();
            }
            
            const data = JSON.parse(response.body);
            const models = processOpenRouterModels(data.data || []);
            
            // Cache the result
            modelCache.put({
                key: OPENROUTER_CACHE_KEY,
                value: JSON.stringify(models),
                ttl: OPENROUTER_CACHE_TTL
            });
            
            return models;
            
        } catch (e) {
            log.error('Failed to fetch OpenRouter models', { error: e.message });
            return getCuratedOpenRouterModels();
        }
    }

    /**
     * Process raw OpenRouter API response into our model format
     * Only includes models that support tool calling
     */
    function processOpenRouterModels(rawModels) {
        return rawModels
            .filter(function(m) {
                // Only include chat models that support tool calling
                return m.id && 
                       m.name && 
                       !m.id.includes('embedding') &&
                       m.supported_parameters &&
                       m.supported_parameters.includes('tools');
            })
            .map(function(m) {
                // Determine tier based on pricing
                var promptPrice = parseFloat(m.pricing?.prompt || 0) * 1000000;
                var tier = 2; // default balanced
                if (promptPrice < 0.5) tier = 1; // cheap = fast tier
                else if (promptPrice > 5) tier = 3; // expensive = premium tier
                
                return {
                    id: m.id,
                    provider: 'openrouter',
                    name: m.name,
                    description: m.description || extractProviderFromId(m.id),
                    tier: tier,
                    pricing: {
                        input: parseFloat(m.pricing?.prompt || 0) * 1000000,
                        output: parseFloat(m.pricing?.completion || 0) * 1000000
                    },
                    contextWindow: m.context_length || 4096,
                    maxOutput: m.top_provider?.max_completion_tokens || 4096,
                    capabilities: buildCapabilities(m),
                    settingsLabel: m.name + ' (' + extractProviderFromId(m.id) + ')'
                };
            })
            .sort(function(a, b) {
                // Sort by tier, then by name
                if (a.tier !== b.tier) return a.tier - b.tier;
                return a.name.localeCompare(b.name);
            });
    }

    /**
     * Extract provider name from model ID (e.g., "anthropic/claude-3" -> "Anthropic")
     */
    function extractProviderFromId(modelId) {
        const provider = modelId.split('/')[0];
        const providerNames = {
            'anthropic': 'Anthropic',
            'openai': 'OpenAI',
            'google': 'Google',
            'meta-llama': 'Meta',
            'mistralai': 'Mistral',
            'deepseek': 'DeepSeek',
            'qwen': 'Qwen',
            'cohere': 'Cohere',
            'perplexity': 'Perplexity',
            'microsoft': 'Microsoft',
            'nous': 'Nous Research',
            'fireworks': 'Fireworks'
        };
        return providerNames[provider] || provider;
    }

    /**
     * Build capabilities array from OpenRouter model data
     */
    function buildCapabilities(model) {
        const caps = ['text'];
        if (model.architecture?.input_modalities?.includes('image')) {
            caps.push('vision');
        }
        if (model.supported_parameters?.includes('tools')) {
            caps.push('tools');
        }
        if (model.supported_parameters?.includes('response_format')) {
            caps.push('json_mode');
        }
        return caps;
    }

    /**
     * Get curated OpenRouter models (fallback when no API key)
     */
    function getCuratedOpenRouterModels() {
        const models = [];
        Object.keys(OPENROUTER_CURATED_MODELS).forEach(function(category) {
            OPENROUTER_CURATED_MODELS[category].forEach(function(m) {
                models.push({
                    id: m.id,
                    provider: 'openrouter',
                    name: m.name,
                    description: extractProviderFromId(m.id),
                    tier: m.tier,
                    contextWindow: 128000,
                    maxOutput: 4096,
                    capabilities: ['text', 'tools'],
                    settingsLabel: m.name + ' (' + extractProviderFromId(m.id) + ')'
                });
            });
        });
        return models;
    }

    // ==========================================
    // DYNAMIC MODEL DISCOVERY FOR ALL PROVIDERS
    // Fetches current models from provider APIs to ensure registry stays up-to-date
    // ==========================================

    const PROVIDER_CACHE_TTL = 3600; // 1 hour for provider models (less volatile than OpenRouter)

    /**
     * Fetch OpenAI models from their API
     * @param {string} apiKey - OpenAI API key
     * @returns {Array} List of available models with tool support
     */
    function fetchOpenAIModels(apiKey) {
        if (!apiKey) {
            Utils.debugLog('No OpenAI API key provided, using static registry');
            return getModelsForProvider('openai');
        }

        try {
            const cacheKey = 'openai_models';
            const modelCache = cache.getCache({
                name: 'GantryProviderModels',
                scope: cache.Scope.PROTECTED
            });

            const cached = modelCache.get({ key: cacheKey });
            if (cached) {
                try {
                    return JSON.parse(cached);
                } catch (e) {
                    Utils.debugLog('OpenAI cache parse error, fetching fresh');
                }
            }

            const response = https.get({
                url: 'https://api.openai.com/v1/models',
                headers: {
                    'Authorization': 'Bearer ' + apiKey,
                    'Content-Type': 'application/json'
                }
            });

            if (response.code !== 200) {
                Utils.debugLog('OpenAI models API error', { code: response.code });
                return getModelsForProvider('openai');
            }

            const data = JSON.parse(response.body);
            const models = processOpenAIModels(data.data || []);

            // Merge with static registry (static has curated metadata)
            const mergedModels = mergeWithStaticRegistry(models, 'openai');

            modelCache.put({
                key: cacheKey,
                value: JSON.stringify(mergedModels),
                ttl: PROVIDER_CACHE_TTL
            });

            return mergedModels;

        } catch (e) {
            log.error('Failed to fetch OpenAI models', { error: e.message });
            return getModelsForProvider('openai');
        }
    }

    /**
     * Process raw OpenAI API model list
     * Filters to chat models that support function calling
     */
    function processOpenAIModels(rawModels) {
        // OpenAI model patterns that support function calling
        const toolSupportPatterns = [
            /^gpt-4/,
            /^gpt-5/,
            /^gpt-3\.5-turbo/,
            /^o1/,
            /^o3/,
            /^o4/
        ];

        return rawModels
            .filter(function(m) {
                // Only include models that match known tool-capable patterns
                return m.id && toolSupportPatterns.some(function(pattern) {
                    return pattern.test(m.id);
                });
            })
            .map(function(m) {
                return {
                    id: m.id,
                    provider: 'openai',
                    name: m.id,
                    discoveredAt: new Date().toISOString(),
                    fromApi: true
                };
            });
    }

    /**
     * Fetch Anthropic models from their API
     * @param {string} apiKey - Anthropic API key
     * @returns {Array} List of available models
     */
    function fetchAnthropicModels(apiKey) {
        if (!apiKey) {
            Utils.debugLog('No Anthropic API key provided, using static registry');
            return getModelsForProvider('anthropic');
        }

        try {
            const cacheKey = 'anthropic_models';
            const modelCache = cache.getCache({
                name: 'GantryProviderModels',
                scope: cache.Scope.PROTECTED
            });

            const cached = modelCache.get({ key: cacheKey });
            if (cached) {
                try {
                    return JSON.parse(cached);
                } catch (e) {
                    Utils.debugLog('Anthropic cache parse error, fetching fresh');
                }
            }

            // Anthropic models API endpoint
            const response = https.get({
                url: 'https://api.anthropic.com/v1/models',
                headers: {
                    'x-api-key': apiKey,
                    'anthropic-version': '2023-06-01',
                    'Content-Type': 'application/json'
                }
            });

            if (response.code !== 200) {
                Utils.debugLog('Anthropic models API error', { code: response.code });
                return getModelsForProvider('anthropic');
            }

            const data = JSON.parse(response.body);
            const models = processAnthropicModels(data.data || data.models || []);

            const mergedModels = mergeWithStaticRegistry(models, 'anthropic');

            modelCache.put({
                key: cacheKey,
                value: JSON.stringify(mergedModels),
                ttl: PROVIDER_CACHE_TTL
            });

            return mergedModels;

        } catch (e) {
            log.error('Failed to fetch Anthropic models', { error: e.message });
            return getModelsForProvider('anthropic');
        }
    }

    /**
     * Process raw Anthropic API model list
     */
    function processAnthropicModels(rawModels) {
        return rawModels
            .filter(function(m) {
                // Filter to Claude models that support tools
                return m.id && m.id.includes('claude');
            })
            .map(function(m) {
                return {
                    id: m.id,
                    provider: 'anthropic',
                    name: m.display_name || m.id,
                    discoveredAt: new Date().toISOString(),
                    fromApi: true
                };
            });
    }

    /**
     * Fetch Gemini models from Google's API
     * @param {string} apiKey - Google AI API key
     * @returns {Array} List of available models
     */
    function fetchGeminiModels(apiKey) {
        if (!apiKey) {
            Utils.debugLog('No Gemini API key provided, using static registry');
            return getModelsForProvider('gemini');
        }

        try {
            const cacheKey = 'gemini_models';
            const modelCache = cache.getCache({
                name: 'GantryProviderModels',
                scope: cache.Scope.PROTECTED
            });

            const cached = modelCache.get({ key: cacheKey });
            if (cached) {
                try {
                    return JSON.parse(cached);
                } catch (e) {
                    Utils.debugLog('Gemini cache parse error, fetching fresh');
                }
            }

            // Google AI models endpoint
            const response = https.get({
                url: 'https://generativelanguage.googleapis.com/v1beta/models?key=' + apiKey,
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            if (response.code !== 200) {
                Utils.debugLog('Gemini models API error', { code: response.code });
                return getModelsForProvider('gemini');
            }

            const data = JSON.parse(response.body);
            const models = processGeminiModels(data.models || []);

            const mergedModels = mergeWithStaticRegistry(models, 'gemini');

            modelCache.put({
                key: cacheKey,
                value: JSON.stringify(mergedModels),
                ttl: PROVIDER_CACHE_TTL
            });

            return mergedModels;

        } catch (e) {
            log.error('Failed to fetch Gemini models', { error: e.message });
            return getModelsForProvider('gemini');
        }
    }

    /**
     * Process raw Gemini API model list
     */
    function processGeminiModels(rawModels) {
        return rawModels
            .filter(function(m) {
                // Filter to generative models that support function calling
                return m.name &&
                       m.name.includes('gemini') &&
                       m.supportedGenerationMethods &&
                       m.supportedGenerationMethods.includes('generateContent');
            })
            .map(function(m) {
                // Extract model ID from full name (e.g., "models/gemini-pro" -> "gemini-pro")
                const modelId = m.name.replace('models/', '');
                return {
                    id: modelId,
                    provider: 'gemini',
                    name: m.displayName || modelId,
                    description: m.description,
                    discoveredAt: new Date().toISOString(),
                    fromApi: true
                };
            });
    }

    /**
     * Merge API-discovered models with static registry
     * Static registry has curated metadata (tier, pricing, capabilities)
     * API discovery adds new models not in static registry
     */
    function mergeWithStaticRegistry(apiModels, providerId) {
        const staticModels = getModelsForProvider(providerId);
        const staticIds = new Set(staticModels.map(function(m) { return m.id; }));

        // Start with static models (they have curated metadata)
        const merged = staticModels.slice();

        // Add any new models from API that aren't in static registry
        apiModels.forEach(function(apiModel) {
            if (!staticIds.has(apiModel.id)) {
                // New model discovered - add with default metadata
                merged.push({
                    id: apiModel.id,
                    provider: providerId,
                    name: apiModel.name || apiModel.id,
                    description: 'Dynamically discovered model',
                    tier: 2, // Default to balanced tier
                    contextWindow: 128000,
                    maxOutput: 4096,
                    capabilities: ['text', 'tools'],
                    discoveredFromApi: true,
                    settingsLabel: apiModel.name + ' (New)'
                });
                Utils.auditLog('New model discovered', {
                    provider: providerId,
                    modelId: apiModel.id
                });
            }
        });

        return merged;
    }

    /**
     * Refresh models for a specific provider
     * Fetches latest models from provider API and updates cache
     * @param {string} providerId - Provider ID (openai, anthropic, gemini, openrouter)
     * @param {string} apiKey - Provider API key
     * @returns {Object} { models: Array, refreshed: boolean, error?: string }
     */
    function refreshProviderModels(providerId, apiKey) {
        try {
            var models;
            switch (providerId) {
                case 'openai':
                    models = fetchOpenAIModels(apiKey);
                    break;
                case 'anthropic':
                    models = fetchAnthropicModels(apiKey);
                    break;
                case 'gemini':
                    models = fetchGeminiModels(apiKey);
                    break;
                case 'openrouter':
                    models = fetchOpenRouterModels(apiKey);
                    break;
                default:
                    return {
                        models: getModelsForProvider(providerId),
                        refreshed: false,
                        error: 'Dynamic refresh not supported for provider: ' + providerId
                    };
            }

            return {
                models: models,
                refreshed: true,
                count: models.length
            };

        } catch (e) {
            log.error('Failed to refresh provider models', {
                provider: providerId,
                error: e.message
            });
            return {
                models: getModelsForProvider(providerId),
                refreshed: false,
                error: e.message
            };
        }
    }

    /**
     * Clear cached models for a provider (forces refresh on next fetch)
     * @param {string} providerId - Provider ID or 'all' for all providers
     */
    function clearModelCache(providerId) {
        try {
            const modelCache = cache.getCache({
                name: 'GantryProviderModels',
                scope: cache.Scope.PROTECTED
            });

            if (providerId === 'all') {
                ['openai_models', 'anthropic_models', 'gemini_models'].forEach(function(key) {
                    try { modelCache.remove({ key: key }); } catch (e) { /* ignore */ }
                });
                // Also clear OpenRouter cache
                const orCache = cache.getCache({
                    name: 'GantryOpenRouterModels',
                    scope: cache.Scope.PROTECTED
                });
                try { orCache.remove({ key: OPENROUTER_CACHE_KEY }); } catch (e) { /* ignore */ }
            } else {
                const key = providerId + '_models';
                modelCache.remove({ key: key });
            }

            Utils.auditLog('Model cache cleared', { provider: providerId });
            return { success: true };

        } catch (e) {
            log.error('Failed to clear model cache', { error: e.message });
            return { success: false, error: e.message };
        }
    }

    // ==========================================
    // PUBLIC API
    // ==========================================

    function getModel(modelId) {
        return MODELS[modelId] || null;
    }

    function getModelsForProvider(providerId) {
        return Object.values(MODELS).filter(function(m) { return m.provider === providerId; });
    }

    function getSettingsOptions(providerId) {
        return getModelsForProvider(providerId)
            .filter(function(m) { return !m.hidden; })
            .sort(function(a, b) {
                if (a.recommended && !b.recommended) return -1;
                if (!a.recommended && b.recommended) return 1;
                return b.tier - a.tier;
            })
            .map(function(m) {
                return {
                    value: m.id,
                    label: m.settingsLabel || m.name
                };
            });
    }

    function getDefaultModel(providerId) {
        var models = getModelsForProvider(providerId);
        var recommended = models.find(function(m) { return m.recommended; });
        return recommended ? recommended.id : models[0]?.id;
    }

    function getProvider(providerId) {
        return PROVIDERS[providerId] || null;
    }

    function getMaxTokensParam(modelId) {
        var model = MODELS[modelId];
        if (!model) return 'max_tokens';
        
        var provider = PROVIDERS[model.provider];
        if (!provider) return 'max_tokens';
        
        var mapping = provider.parameterMappings[modelId] || 
                     provider.parameterMappings[modelId.split('-')[0]] ||
                     provider.parameterMappings['default'];
        
        return mapping?.maxTokensParam || provider.defaultMaxTokensParam || 'max_tokens';
    }

    function getParamWrapper(modelId) {
        var model = MODELS[modelId];
        if (!model) return null;
        
        var provider = PROVIDERS[model.provider];
        if (!provider) return null;
        
        var mapping = provider.parameterMappings[modelId] || 
                     provider.parameterMappings[modelId.split('-')[0]] ||
                     provider.parameterMappings['default'];
        
        return mapping?.wrapper || null;
    }

    function getModelForTier(providerId, tier, selectedModel, tierConfig) {
        if (tierConfig && tierConfig.tierConfigEnabled) {
            var tierKey = 'tier' + tier;
            var configModel = tierConfig[tierKey + 'Model'];
            
            if (configModel) {
                var modelDef = MODELS[configModel];
                var detectedProvider = modelDef ? modelDef.provider : null;
                var configProvider = detectedProvider || tierConfig[tierKey + 'Provider'] || providerId;
                
                return {
                    provider: configProvider,
                    model: configModel
                };
            }
        }
        
        if (providerId === 'netsuite' || providerId === 'openrouter') {
            return {
                provider: providerId,
                model: selectedModel
            };
        }
        
        var tierModels = TIERS[providerId];
        if (!tierModels) {
            return {
                provider: providerId,
                model: selectedModel
            };
        }
        
        if (tier === 3) {
            var selected = MODELS[selectedModel];
            if (selected && selected.tier === 3) {
                return {
                    provider: providerId,
                    model: selectedModel
                };
            }
        }
        
        return {
            provider: providerId,
            model: tierModels[tier] || selectedModel
        };
    }
    
    function getModelForTierSimple(providerId, tier, selectedModel) {
        var result = getModelForTier(providerId, tier, selectedModel, null);
        return result.model;
    }

    function getModelDisplayInfo(modelId) {
        var model = MODELS[modelId];
        if (!model) {
            // Check if it's an OpenRouter model (contains /)
            if (modelId && modelId.includes('/')) {
                var tier = 2; // default
                return {
                    name: modelId.split('/')[1] || modelId,
                    tier: tier,
                    tierName: 'Balanced',
                    speed: 'T2',
                    cost: '$$',
                    description: 'OpenRouter: ' + extractProviderFromId(modelId)
                };
            }
            return { 
                name: modelId, 
                tier: 'unknown', 
                tierName: 'Unknown',
                speed: '?', 
                cost: '?' 
            };
        }
        
        // Updated tier labels - T1/T2/T3 pills instead of rockets
        var tierNames = { 1: 'Fast', 2: 'Balanced', 3: 'Premium' };
        var tierLabelsShort = { 1: 'T1', 2: 'T2', 3: 'T3' };
        var costIcons = { 1: '$', 2: '$$', 3: '$$$' };
        
        return {
            name: model.name,
            tier: model.tier,
            tierName: tierNames[model.tier] || 'Unknown',
            tierLabel: tierLabelsShort[model.tier] || '?',
            speed: tierLabelsShort[model.tier] || '?',
            cost: model.provider === 'netsuite' ? 'included' : costIcons[model.tier],
            pricing: model.pricing,
            description: model.description
        };
    }

    function buildApiParams(modelId, params) {
        var maxTokensParam = getMaxTokensParam(modelId);
        var wrapper = getParamWrapper(modelId);
        
        var result = {};
        
        if (params.maxTokens !== undefined) {
            if (wrapper) {
                result[wrapper] = result[wrapper] || {};
                result[wrapper][maxTokensParam] = params.maxTokens;
            } else {
                result[maxTokensParam] = params.maxTokens;
            }
        }
        
        if (params.temperature !== undefined) {
            if (wrapper) {
                result[wrapper] = result[wrapper] || {};
                result[wrapper].temperature = params.temperature;
            } else {
                result.temperature = params.temperature;
            }
        }
        
        Object.keys(params).forEach(function(key) {
            if (key !== 'maxTokens' && key !== 'temperature') {
                result[key] = params[key];
            }
        });
        
        return result;
    }

    function hasCapability(modelId, capability) {
        var model = MODELS[modelId];
        // For OpenRouter models (contain /), assume basic capabilities
        if (!model && modelId && modelId.includes('/')) {
            return ['text', 'tools', 'json_mode'].includes(capability);
        }
        return model && model.capabilities && model.capabilities.includes(capability);
    }

    function supportsTemperature(modelId) {
        var model = MODELS[modelId];
        if (!model) return true;
        if (model.supportsTemperature !== undefined) {
            return model.supportsTemperature;
        }
        return true;
    }

    // ==========================================
    // SETTINGS UI HELPERS - Updated with T1/T2/T3
    // ==========================================
    
    /**
     * Get all models formatted for tier settings dropdown
     * Uses T1/T2/T3 pills instead of rocket ships
     */
    function getAllModelsForTierSettings() {
        var models = [];
        // Pill-style tier labels
        var tierLabels = { 1: 'T1 Fast', 2: 'T2 Balanced', 3: 'T3 Premium' };
        var providerLabels = {
            gemini: 'Gemini',
            anthropic: 'Claude', 
            openai: 'OpenAI',
            grok: 'Grok',
            netsuite: 'NetSuite'
        };
        
        var sortedModels = Object.values(MODELS)
            .filter(function(m) { return !m.hidden; })
            .sort(function(a, b) {
                var providerOrder = { gemini: 0, anthropic: 1, openai: 2, grok: 3, netsuite: 4 };
                var providerDiff = (providerOrder[a.provider] || 99) - (providerOrder[b.provider] || 99);
                if (providerDiff !== 0) return providerDiff;
                return a.tier - b.tier;
            });
        
        sortedModels.forEach(function(model) {
            models.push({
                value: model.id,
                label: (providerLabels[model.provider] || model.provider) + ': ' + model.name + ' [' + tierLabels[model.tier] + ']',
                provider: model.provider,
                tier: model.tier,
                tierLabel: 'T' + model.tier
            });
        });
        
        return models;
    }
    
    /**
     * Get models for a specific provider, formatted for settings dropdown
     */
    function getModelsForProviderSettings(providerId) {
        var tierLabels = { 1: 'T1 Fast', 2: 'T2 Balanced', 3: 'T3 Premium' };
        
        var providerModels = Object.values(MODELS)
            .filter(function(m) { return m.provider === providerId && !m.hidden; })
            .sort(function(a, b) { return a.tier - b.tier; });
        
        return providerModels.map(function(model) {
            return {
                value: model.id,
                label: model.name + ' [' + tierLabels[model.tier] + ']' + (model.recommended ? ' ★' : ''),
                tier: model.tier,
                tierLabel: 'T' + model.tier
            };
        });
    }
    
    /**
     * Get complete model data for Settings UI
     * Returns both all models and models grouped by provider
     */
    function getModelsForSettings() {
        var allModels = getAllModelsForTierSettings();
        
        var modelsByProvider = {
            gemini: getModelsForProviderSettings('gemini'),
            anthropic: getModelsForProviderSettings('anthropic'),
            openai: getModelsForProviderSettings('openai'),
            grok: getModelsForProviderSettings('grok'),
            netsuite: getModelsForProviderSettings('netsuite'),
            openrouter: [] // Will be populated dynamically
        };
        
        return {
            models: allModels,
            modelsByProvider: modelsByProvider,
            // Include OpenRouter curated models as starting point
            openrouterCurated: getCuratedOpenRouterModels()
        };
    }

    /**
     * Get OpenRouter models for settings UI
     * @param {string} apiKey - OpenRouter API key (optional)
     * @returns {Object} { models: Array, cached: boolean }
     */
    function getOpenRouterModelsForSettings(apiKey) {
        var models = fetchOpenRouterModels(apiKey);
        var tierLabels = { 1: 'T1 Fast', 2: 'T2 Balanced', 3: 'T3 Premium' };
        
        return {
            models: models.map(function(m) {
                return {
                    value: m.id,
                    label: m.name + ' [' + tierLabels[m.tier] + ']',
                    tier: m.tier,
                    tierLabel: 'T' + m.tier,
                    provider: extractProviderFromId(m.id)
                };
            }),
            count: models.length
        };
    }

    /**
     * Get retry guidance for agent queries
     */
    function getRetryGuidance() {
        return {
            maxRetries: 3,
            strategies: [
                {
                    errorType: 'TABLE_NOT_ALLOWED',
                    guidance: 'The table you tried to use is not in the allowed list. Do NOT join on the "entity" table directly. Instead use BUILTIN.DF(transaction.entity) to get customer/vendor names.',
                    example: 'Instead of: JOIN entity ON transaction.entity = entity.id ... Use: SELECT BUILTIN.DF(transaction.entity) AS customer_name FROM transaction'
                },
                {
                    errorType: 'SYNTAX',
                    guidance: 'Fix the SQL syntax error. Common issues: missing quotes around strings, incorrect function names. Use FETCH FIRST N ROWS ONLY not LIMIT.',
                    example: "Change WHERE name = John to WHERE name = 'John'. Use FETCH FIRST 10 ROWS ONLY not LIMIT 10."
                },
                {
                    errorType: 'INVALID_FIELD',
                    guidance: 'The field does not exist on this record type. Check the Record Browser for valid field IDs.',
                    example: 'Use transaction.tranid instead of transaction.documentnumber'
                },
                {
                    errorType: 'UNKNOWN',
                    guidance: 'Try simplifying the query - remove complex joins, use basic aggregations.',
                    example: 'Start with a simple SELECT * FROM table FETCH FIRST 5 ROWS ONLY to verify access'
                }
            ]
        };
    }

    function getGuidanceForError(errorType) {
        var guidance = getRetryGuidance();
        var strategy = guidance.strategies.find(function(s) { return s.errorType === errorType; }) ||
                      guidance.strategies.find(function(s) { return s.errorType === 'UNKNOWN'; });
        return strategy;
    }

    // ==========================================
    // EXPORTS
    // ==========================================
    
    return {
        // Model access
        getModel: getModel,
        getModelsForProvider: getModelsForProvider,
        getSettingsOptions: getSettingsOptions,
        getDefaultModel: getDefaultModel,
        
        // Settings UI helpers
        getAllModelsForTierSettings: getAllModelsForTierSettings,
        getModelsForProviderSettings: getModelsForProviderSettings,
        getModelsForSettings: getModelsForSettings,
        getOpenRouterModelsForSettings: getOpenRouterModelsForSettings,
        
        // Dynamic model discovery (all providers)
        fetchOpenRouterModels: fetchOpenRouterModels,
        fetchOpenAIModels: fetchOpenAIModels,
        fetchAnthropicModels: fetchAnthropicModels,
        fetchGeminiModels: fetchGeminiModels,
        refreshProviderModels: refreshProviderModels,
        clearModelCache: clearModelCache,
        getCuratedOpenRouterModels: getCuratedOpenRouterModels,

        // Provider access
        getProvider: getProvider,
        PROVIDERS: PROVIDERS,
        
        // Tier system
        getModelForTier: getModelForTier,
        getModelForTierSimple: getModelForTierSimple,
        getModelDisplayInfo: getModelDisplayInfo,
        TIERS: TIERS,
        
        // API parameter building
        getMaxTokensParam: getMaxTokensParam,
        getParamWrapper: getParamWrapper,
        buildApiParams: buildApiParams,
        
        // Capabilities
        hasCapability: hasCapability,
        supportsTemperature: supportsTemperature,
        
        // Retry guidance
        getRetryGuidance: getRetryGuidance,
        getGuidanceForError: getGuidanceForError,
        
        // Raw data access
        MODELS: MODELS
    };
});