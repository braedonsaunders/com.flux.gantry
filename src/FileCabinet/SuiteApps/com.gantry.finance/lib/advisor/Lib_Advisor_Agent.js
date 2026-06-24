/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 *
 * Lib_Advisor_Agent.js
 * Native tool-use agent loop (feature-flagged via config `useNativeToolLoop`).
 *
 * Thin facade over Lib_Advisor_StreamingAgent: it shares `initState` (identical
 * state shape, so the cache / polling / step machinery is unchanged) and routes
 * `runStep` to the native `runStepNative`, which drives data gathering through
 * each provider's NATIVE function-calling API instead of the legacy JSON-action
 * protocol. INTENT, RESPOND, buildFinalResponse and the UX step emitters are
 * reused as-is — only the REASON_ACT decision mechanism differs.
 */
define([
    './Lib_Advisor_StreamingAgent',
    '../Lib_Config'
], function(StreamingAgent, Config) {
    'use strict';

    /** Best-effort provider detection from an explicit provider or a model id. */
    function detectProvider(provider, model) {
        if (provider) return provider;
        if (!model) return null;
        if (model.indexOf('gemini') === 0) return 'gemini';
        if (model.indexOf('claude') === 0) return 'anthropic';
        if (model.indexOf('gpt') === 0 || model.indexOf('o1') === 0 ||
            model.indexOf('o3') === 0 || model.indexOf('o4') === 0) return 'openai';
        if (model.indexOf('grok') === 0) return 'grok';
        if (model.indexOf('cohere') === 0 || model.indexOf('meta-') === 0) return 'netsuite';
        if (model.indexOf('/') !== -1) return 'openrouter';
        return null;
    }

    /**
     * Whether the native tool-use loop is enabled. Default ON for the real-API
     * providers (Anthropic, OpenAI, Gemini, OpenRouter, Grok). NetSuite's built-in
     * N/llm (Cohere) can't round-trip native multi-turn tool calls, so a netsuite-only
     * configuration stays on the legacy loop. In custom mode the provider is resolved
     * per tier, so native is enabled when any tier uses a real-API provider. Set
     * `useNativeToolLoop: false` to force legacy everywhere (no redeploy). On a config
     * read failure we fall back to the legacy loop (safe default).
     */
    function isEnabled() {
        try {
            const cfg = Config.getStoredConfiguration('main') || {};
            if (cfg.useNativeToolLoop === false || cfg.useNativeToolLoop === 'false') return false;

            const isCustom = cfg.aiMode === 'custom' ||
                cfg.tierConfigEnabled === true || cfg.tierConfigEnabled === 'true';
            if (isCustom) {
                // Provider comes from the tier config in custom mode. Enable native unless
                // the configuration is netsuite-only; unset tiers default to a real-API provider.
                const providers = [
                    detectProvider(cfg.tier1Provider, cfg.tier1Model),
                    detectProvider(cfg.tier2Provider, cfg.tier2Model),
                    detectProvider(cfg.tier3Provider, cfg.tier3Model)
                ].filter(function(p) { return !!p; });
                if (providers.length === 0) return true;
                return providers.some(function(p) { return p !== 'netsuite'; });
            }

            return (cfg.aiProvider || 'netsuite') !== 'netsuite';
        } catch (e) {
            return false;
        }
    }

    return {
        isEnabled: isEnabled,
        // Shared state shape — initState is the same object the legacy loop uses.
        initState: StreamingAgent.initState,
        // Native per-poll step.
        runStep: StreamingAgent.runStepNative
    };
});
