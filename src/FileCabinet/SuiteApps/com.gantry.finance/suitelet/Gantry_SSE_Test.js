/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope Public
 *
 * Gantry_SSE_Test.js
 *
 * EXPERIMENTAL: Test Server-Sent Events (SSE) streaming from NetSuite
 *
 * This Suitelet attempts to stream partial responses using SSE format.
 * If successful, this enables real-time progressive updates to the frontend.
 *
 * SSE Format:
 *   data: {"type":"step","content":"..."}\n\n
 *
 * Frontend consumption:
 *   const eventSource = new EventSource(suiteletUrl);
 *   eventSource.onmessage = (e) => console.log(JSON.parse(e.data));
 */
define([
    'N/log',
    'N/search',
    'N/query'
], function(log, search, query) {
    'use strict';

    /**
     * Send an SSE event
     * @param {ServerResponse} response - NetSuite response object
     * @param {object} data - Data to send
     */
    function sendEvent(response, data) {
        const eventData = 'data: ' + JSON.stringify(data) + '\n\n';
        response.write(eventData);

        // Try to flush if method exists (undocumented)
        if (typeof response.flush === 'function') {
            response.flush();
        }
    }

    /**
     * Simulate a delay (blocking)
     * @param {number} ms - Milliseconds to wait
     */
    function simulateWork(ms) {
        const start = Date.now();
        while (Date.now() - start < ms) {
            // Busy wait - not ideal but only way in NetSuite
        }
    }

    /**
     * Handle GET requests - SSE stream
     */
    function onRequest(context) {
        const request = context.request;
        const response = context.response;

        // Only handle GET for SSE
        if (request.method !== 'GET') {
            response.write(JSON.stringify({ error: 'Use GET for SSE' }));
            return;
        }

        const mode = request.parameters.mode || 'simple';

        log.debug('SSE Test Starting', { mode: mode });

        try {
            // Set SSE headers
            response.setHeader({
                name: 'Content-Type',
                value: 'text/event-stream'
            });
            response.setHeader({
                name: 'Cache-Control',
                value: 'no-cache'
            });
            response.setHeader({
                name: 'Connection',
                value: 'keep-alive'
            });
            // CORS headers for cross-origin if needed
            response.setHeader({
                name: 'Access-Control-Allow-Origin',
                value: '*'
            });

            if (mode === 'simple') {
                // Simple test - just send a few events with delays
                runSimpleTest(response);
            } else if (mode === 'advisor') {
                // Simulate advisor flow
                runAdvisorSimulation(response);
            } else if (mode === 'query') {
                // Test with actual database queries
                runQueryTest(response);
            }

            // Send completion event
            sendEvent(response, {
                type: 'complete',
                message: 'Stream finished',
                timestamp: Date.now()
            });

            log.debug('SSE Test Complete', { mode: mode });

        } catch (e) {
            log.error('SSE Test Error', { message: e.message, stack: e.stack });

            // Try to send error event
            try {
                sendEvent(response, {
                    type: 'error',
                    message: e.message
                });
            } catch (writeErr) {
                // Response may already be closed
            }
        }
    }

    /**
     * Simple test - send numbered events with delays
     */
    function runSimpleTest(response) {
        for (let i = 1; i <= 5; i++) {
            sendEvent(response, {
                type: 'step',
                step: i,
                message: `Processing step ${i} of 5...`,
                timestamp: Date.now()
            });

            // Simulate work (1 second between events)
            simulateWork(1000);
        }
    }

    /**
     * Simulate advisor flow with realistic steps
     */
    function runAdvisorSimulation(response) {
        // Step 1: Thinking
        sendEvent(response, {
            type: 'thinking',
            title: 'Understanding your question...',
            timestamp: Date.now()
        });
        simulateWork(500);

        // Step 2: Tool call - resolve entity
        sendEvent(response, {
            type: 'tool_call',
            tool: 'resolve_classification',
            params: { term: 'Hotels', dimension: 'class' },
            status: 'running',
            timestamp: Date.now()
        });
        simulateWork(1500);

        // Step 3: Tool result
        sendEvent(response, {
            type: 'tool_result',
            tool: 'resolve_classification',
            status: 'complete',
            result: { found: false, message: 'Not found' },
            timestamp: Date.now()
        });
        simulateWork(300);

        // Step 4: Another tool call
        sendEvent(response, {
            type: 'tool_call',
            tool: 'get_gl_activity',
            params: { period: 'last_90_days' },
            status: 'running',
            timestamp: Date.now()
        });
        simulateWork(2000);

        // Step 5: Tool result with data
        sendEvent(response, {
            type: 'tool_result',
            tool: 'get_gl_activity',
            status: 'complete',
            result: { rowCount: 42, sample: ['Entry 1', 'Entry 2'] },
            timestamp: Date.now()
        });
        simulateWork(300);

        // Step 6: Synthesizing
        sendEvent(response, {
            type: 'synthesizing',
            title: 'Analyzing results...',
            timestamp: Date.now()
        });
        simulateWork(1000);

        // Step 7: Final answer (could be chunked for text streaming)
        sendEvent(response, {
            type: 'answer',
            content: 'Based on my analysis of the GL activity, I found 42 transactions in the last 90 days. The largest variance was...',
            timestamp: Date.now()
        });
    }

    /**
     * Test with actual database queries to measure real timing
     */
    function runQueryTest(response) {
        // Step 1: Start
        sendEvent(response, {
            type: 'step',
            message: 'Starting database query test...',
            timestamp: Date.now()
        });

        // Step 2: Run a simple query
        sendEvent(response, {
            type: 'query_start',
            message: 'Querying accounts...',
            timestamp: Date.now()
        });

        try {
            const results = query.runSuiteQL({
                query: `SELECT id, acctnumber, acctname FROM account WHERE isinactive = 'F' FETCH FIRST 10 ROWS ONLY`
            }).asMappedResults();

            sendEvent(response, {
                type: 'query_complete',
                message: `Found ${results.length} accounts`,
                rowCount: results.length,
                timestamp: Date.now()
            });
        } catch (e) {
            sendEvent(response, {
                type: 'query_error',
                message: e.message,
                timestamp: Date.now()
            });
        }

        simulateWork(500);

        // Step 3: Another query
        sendEvent(response, {
            type: 'query_start',
            message: 'Querying transactions...',
            timestamp: Date.now()
        });

        try {
            const txnResults = query.runSuiteQL({
                query: `SELECT id, tranid, type FROM transaction FETCH FIRST 5 ROWS ONLY`
            }).asMappedResults();

            sendEvent(response, {
                type: 'query_complete',
                message: `Found ${txnResults.length} transactions`,
                rowCount: txnResults.length,
                timestamp: Date.now()
            });
        } catch (e) {
            sendEvent(response, {
                type: 'query_error',
                message: e.message,
                timestamp: Date.now()
            });
        }
    }

    return {
        onRequest: onRequest
    };
});
