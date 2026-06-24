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

    /**
     * Whether the native tool-use loop is enabled. Default: ON for the real-API
     * providers (Anthropic, OpenAI, Gemini, OpenRouter, Grok). NetSuite's built-in
     * N/llm (Cohere) does not round-trip native multi-turn tool calls reliably, so it
     * stays on the proven legacy loop. Set `useNativeToolLoop: false` in the main
     * config to force the legacy loop for every provider (no redeploy). On a config
     * read failure we fall back to the legacy loop (safe default).
     */
    function isEnabled() {
        try {
            const cfg = Config.getStoredConfiguration('main') || {};
            if (cfg.useNativeToolLoop === false || cfg.useNativeToolLoop === 'false') return false;
            const provider = cfg.aiProvider || 'netsuite';
            if (provider === 'netsuite') return false;
            return true;
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
