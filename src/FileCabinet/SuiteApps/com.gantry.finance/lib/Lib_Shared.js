/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @module Lib_Shared
 * @description Shared utility functions for all Gantry modules
 */
define(["N/query", "N/format", "N/log"], function (query, format, log) {
    
    function runSuiteQL(sql) {
        try {
            return query.runSuiteQL({ query: sql }).asMappedResults();
        } catch (e) {
            log.error('SuiteQL Error', e.message);
            return [];
        }
    }

    function formatDateYMD(d) {
        if (!d) return null;
        const date = new Date(d);
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");
        return `${y}-${m}-${day}`;
    }

    function round2(n) {
        return Math.round((parseFloat(n) || 0) * 100) / 100;
    }

    function safeDiv(n, d) {
        return d > 0 ? n / d : 0.0;
    }

    return { runSuiteQL, formatDateYMD, round2, safeDiv };
});
