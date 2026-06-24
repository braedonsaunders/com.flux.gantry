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
     * Whether the native tool-use loop is enabled. Default: ON (Phase 3 cutover).
     * The legacy phase machine remains available as an instant fallback — set
     * `useNativeToolLoop: false` in the main config to switch back with no redeploy.
     * On a config read failure we fall back to the legacy loop (safe default).
     */
    function isEnabled() {
        try {
            const cfg = Config.getStoredConfiguration('main') || {};
            return cfg.useNativeToolLoop !== false && cfg.useNativeToolLoop !== 'false';
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
