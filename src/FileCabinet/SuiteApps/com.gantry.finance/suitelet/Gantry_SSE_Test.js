/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope Public
 *
 * Gantry_SSE_Test.js
 *
 * EXPERIMENTAL: Test streaming/chunked responses from NetSuite
 *
 * This tests whether NetSuite flushes response.write() calls immediately
 * or buffers them until the script completes.
 *
 * MODES:
 * - instant: Write all at once (control test)
 * - simple: Write with delays (test HTTP streaming)
 * - advisor: Simulate advisor flow
 * - llm: Test actual LLM streaming with llm.generateTextStreamed()
 */
define([
    'N/log',
    'N/llm'
], function(log, llm) {
    'use strict';

    /**
     * Simulate a delay (blocking)
     */
    function simulateWork(ms) {
        const start = Date.now();
        while (Date.now() - start < ms) {
            // Busy wait - this is intentional for testing streaming
        }
    }

    /**
     * Write a chunk of data in the specified format
     */
    function writeChunk(response, data, format) {
        let output;

        if (format === 'sse') {
            output = 'data: ' + JSON.stringify(data) + '\n\n';
        } else if (format === 'ndjson') {
            output = JSON.stringify(data) + '\n';
        } else {
            // Plain text with delimiter (default, safest)
            output = '---CHUNK---' + JSON.stringify(data) + '---END---\n';
        }

        response.write(output);
    }

    /**
     * Handle GET requests
     */
    function onRequest(context) {
        const request = context.request;
        const response = context.response;

        // Handle non-GET gracefully
        if (request.method !== 'GET') {
            response.write(JSON.stringify({ error: 'Use GET method' }));
            return;
        }

        const mode = request.parameters.mode || 'simple';
        const format = request.parameters.format || 'plain'; // plain is safest default

        log.debug('SSE Test Starting', { mode: mode, format: format });

        // Set content type - use only safe, known-working types
        // NetSuite is picky about headers, so we use only basic ones
        try {
            if (format === 'sse') {
                // SSE content type - may not work
                response.setHeader({
                    name: 'Content-Type',
                    value: 'text/event-stream'
                });
            } else {
                // Plain text works reliably
                response.setHeader({
                    name: 'Content-Type',
                    value: 'text/plain'
                });
            }
        } catch (headerErr) {
            // If header fails, continue with default - NetSuite will use text/html
            log.error('Header Error', headerErr.message);
        }

        // Wrap everything in try-catch to prevent 500 errors
        try {
            // Write initial chunk immediately
            writeChunk(response, {
                type: 'start',
                message: 'Stream starting...',
                mode: mode,
                format: format,
                timestamp: Date.now()
            }, format);

            if (mode === 'instant') {
                // Control test - write everything at once, no delays
                runInstantTest(response, format);
            } else if (mode === 'simple') {
                // Main test - write with delays to test streaming
                runSimpleTest(response, format);
            } else if (mode === 'advisor') {
                // Simulate advisor flow
                runAdvisorSimulation(response, format);
            } else if (mode === 'llm') {
                // Test actual LLM streaming with llm.generateTextStreamed()
                runLLMStreamingTest(response, format);
            } else {
                writeChunk(response, {
                    type: 'error',
                    message: 'Unknown mode: ' + mode
                }, format);
            }

            // Send completion
            writeChunk(response, {
                type: 'complete',
                message: 'Stream finished successfully',
                timestamp: Date.now()
            }, format);

            log.debug('SSE Test Complete', { mode: mode });

        } catch (e) {
            log.error('SSE Test Error', { message: e.message, stack: e.stack });
            try {
                writeChunk(response, {
                    type: 'error',
                    message: 'Error: ' + e.message
                }, format);
            } catch (writeErr) {
                // Last resort - plain text error
                response.write('ERROR: ' + e.message);
            }
        }
    }

    /**
     * Control test - write everything instantly (no delays)
     * This should return immediately with all data
     */
    function runInstantTest(response, format) {
        for (let i = 1; i <= 5; i++) {
            writeChunk(response, {
                type: 'step',
                step: i,
                total: 5,
                message: 'Instant step ' + i,
                timestamp: Date.now()
            }, format);
        }
    }

    /**
     * Simple test - numbered events with delays
     * This is the KEY test: do chunks arrive during the 5 seconds,
     * or does everything arrive at once after 5 seconds?
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

            // 1 second delay between events
            simulateWork(1000);
        }
    }

    /**
     * Simulate advisor flow with thinking, tool calls, and answer
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
     * Test actual LLM streaming with llm.generateTextStreamed()
     * This is the ultimate test: can we stream LLM tokens to the user in real-time?
     */
    function runLLMStreamingTest(response, format) {
        writeChunk(response, {
            type: 'llm_start',
            message: 'Starting LLM streaming test...',
            timestamp: Date.now()
        }, format);

        try {
            // Use llm.generateTextStreamed() to get an iterator of tokens
            const streamedResponse = llm.generateTextStreamed({
                prompt: 'Count from 1 to 10 slowly, with one number per line and a brief pause between each. Make it dramatic.',
                modelFamily: llm.ModelFamily.CLAUDE,
                modelParameters: {
                    maxTokens: 500
                }
            });

            let tokenCount = 0;
            let fullText = '';

            // Iterate over the streamed tokens
            for (const chunk of streamedResponse) {
                tokenCount++;

                // chunk.text contains the partial text from this chunk
                if (chunk.text) {
                    fullText += chunk.text;

                    // Write each token to the HTTP response
                    writeChunk(response, {
                        type: 'llm_token',
                        tokenNum: tokenCount,
                        text: chunk.text,
                        timestamp: Date.now()
                    }, format);
                }

                // Also check for any other properties on the chunk
                if (chunk.finishReason) {
                    writeChunk(response, {
                        type: 'llm_finish',
                        reason: chunk.finishReason,
                        timestamp: Date.now()
                    }, format);
                }
            }

            writeChunk(response, {
                type: 'llm_complete',
                totalTokens: tokenCount,
                fullText: fullText,
                timestamp: Date.now()
            }, format);

        } catch (e) {
            writeChunk(response, {
                type: 'llm_error',
                message: e.message,
                name: e.name,
                timestamp: Date.now()
            }, format);
        }
    }

    return {
        onRequest: onRequest
    };
});
