/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope Public
 *
 * Gantry_SSE_Test.js
 *
 * EXPERIMENTAL: Test streaming/chunked responses from NetSuite
 *
 * Tests multiple approaches:
 * 1. Plain text with newlines (safest)
 * 2. JSON Lines format (NDJSON)
 * 3. SSE format (may not work if headers rejected)
 */
define([
    'N/log',
    'N/query'
], function(log, query) {
    'use strict';

    /**
     * Write a chunk of data
     */
    function writeChunk(response, data, format) {
        let output;

        if (format === 'sse') {
            output = 'data: ' + JSON.stringify(data) + '\n\n';
        } else if (format === 'ndjson') {
            output = JSON.stringify(data) + '\n';
        } else {
            // Plain text with delimiter
            output = '---CHUNK---' + JSON.stringify(data) + '---END---\n';
        }

        response.write(output);
    }

    /**
     * Simulate a delay (blocking)
     */
    function simulateWork(ms) {
        const start = Date.now();
        while (Date.now() - start < ms) {
            // Busy wait
        }
    }

    /**
     * Handle GET requests
     */
    function onRequest(context) {
        const request = context.request;
        const response = context.response;

        if (request.method !== 'GET') {
            response.write(JSON.stringify({ error: 'Use GET' }));
            return;
        }

        const mode = request.parameters.mode || 'simple';
        const format = request.parameters.format || 'ndjson'; // ndjson, sse, plain

        log.debug('Streaming Test Starting', { mode: mode, format: format });

        // Try to set appropriate content type based on format
        try {
            if (format === 'sse') {
                // This might fail in NetSuite
                response.setHeader({
                    name: 'Content-Type',
                    value: 'text/event-stream; charset=utf-8'
                });
            } else if (format === 'ndjson') {
                response.setHeader({
                    name: 'Content-Type',
                    value: 'application/x-ndjson'
                });
            } else {
                response.setHeader({
                    name: 'Content-Type',
                    value: 'text/plain; charset=utf-8'
                });
            }
        } catch (headerErr) {
            log.error('Header error', headerErr.message);
            // Continue anyway with default content type
        }

        // Don't try Connection header - NetSuite doesn't allow it
        // Don't try Cache-Control in setHeader - use different approach if needed

        try {
            if (mode === 'simple') {
                runSimpleTest(response, format);
            } else if (mode === 'advisor') {
                runAdvisorSimulation(response, format);
            } else if (mode === 'query') {
                runQueryTest(response, format);
            } else if (mode === 'instant') {
                // Control test - write everything at once
                runInstantTest(response, format);
            }

            // Send completion
            writeChunk(response, {
                type: 'complete',
                message: 'Stream finished',
                timestamp: Date.now()
            }, format);

            log.debug('Streaming Test Complete', { mode: mode });

        } catch (e) {
            log.error('Streaming Test Error', { message: e.message, stack: e.stack });
            writeChunk(response, {
                type: 'error',
                message: e.message
            }, format);
        }
    }

    /**
     * Simple test - numbered events with delays
     */
    function runSimpleTest(response, format) {
        for (let i = 1; i <= 5; i++) {
            writeChunk(response, {
                type: 'step',
                step: i,
                total: 5,
                message: 'Processing step ' + i + ' of 5...',
                timestamp: Date.now()
            }, format);

            // 1 second between events
            simulateWork(1000);
        }
    }

    /**
     * Control test - write everything instantly (no delays)
     */
    function runInstantTest(response, format) {
        for (let i = 1; i <= 10; i++) {
            writeChunk(response, {
                type: 'step',
                step: i,
                timestamp: Date.now()
            }, format);
        }
    }

    /**
     * Simulate advisor flow
     */
    function runAdvisorSimulation(response, format) {
        writeChunk(response, {
            type: 'thinking',
            title: 'Understanding your question...',
            timestamp: Date.now()
        }, format);
        simulateWork(500);

        writeChunk(response, {
            type: 'tool_call',
            tool: 'resolve_classification',
            params: { term: 'Hotels', dimension: 'class' },
            status: 'running',
            timestamp: Date.now()
        }, format);
        simulateWork(1500);

        writeChunk(response, {
            type: 'tool_result',
            tool: 'resolve_classification',
            status: 'complete',
            result: { found: false },
            timestamp: Date.now()
        }, format);
        simulateWork(300);

        writeChunk(response, {
            type: 'tool_call',
            tool: 'get_gl_activity',
            params: { period: 'last_90_days' },
            status: 'running',
            timestamp: Date.now()
        }, format);
        simulateWork(2000);

        writeChunk(response, {
            type: 'tool_result',
            tool: 'get_gl_activity',
            status: 'complete',
            result: { rowCount: 42 },
            timestamp: Date.now()
        }, format);
        simulateWork(300);

        writeChunk(response, {
            type: 'synthesizing',
            title: 'Analyzing results...',
            timestamp: Date.now()
        }, format);
        simulateWork(1000);

        writeChunk(response, {
            type: 'answer',
            content: 'Based on my analysis, I found 42 GL transactions in the last 90 days.',
            timestamp: Date.now()
        }, format);
    }

    /**
     * Test with real database queries
     */
    function runQueryTest(response, format) {
        writeChunk(response, {
            type: 'start',
            message: 'Starting database query test...',
            timestamp: Date.now()
        }, format);

        // Query 1: Accounts
        writeChunk(response, {
            type: 'query_start',
            query: 'accounts',
            timestamp: Date.now()
        }, format);

        try {
            const results = query.runSuiteQL({
                query: "SELECT id, acctnumber, acctname FROM account WHERE isinactive = 'F' FETCH FIRST 10 ROWS ONLY"
            }).asMappedResults();

            writeChunk(response, {
                type: 'query_result',
                query: 'accounts',
                rowCount: results.length,
                timestamp: Date.now()
            }, format);
        } catch (e) {
            writeChunk(response, {
                type: 'query_error',
                query: 'accounts',
                error: e.message,
                timestamp: Date.now()
            }, format);
        }

        simulateWork(500);

        // Query 2: Transactions
        writeChunk(response, {
            type: 'query_start',
            query: 'transactions',
            timestamp: Date.now()
        }, format);

        try {
            const txnResults = query.runSuiteQL({
                query: "SELECT id, tranid, type FROM transaction FETCH FIRST 5 ROWS ONLY"
            }).asMappedResults();

            writeChunk(response, {
                type: 'query_result',
                query: 'transactions',
                rowCount: txnResults.length,
                timestamp: Date.now()
            }, format);
        } catch (e) {
            writeChunk(response, {
                type: 'query_error',
                query: 'transactions',
                error: e.message,
                timestamp: Date.now()
            }, format);
        }
    }

    return {
        onRequest: onRequest
    };
});
