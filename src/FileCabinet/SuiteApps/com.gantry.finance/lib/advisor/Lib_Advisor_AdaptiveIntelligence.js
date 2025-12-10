/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * 
 * Lib_Advisor_AdaptiveIntelligence.js
 * 
 * Advanced cognitive architecture for complex multi-step analysis.
 * Implements:
 * - Working Memory (persistent state across iterations)
 * - Hypothesis-Driven Investigation
 * - Automatic Reflection Triggers
 * - Confidence-Weighted Conclusions
 * - Plan Revision with Backtracking
 * 
 * Based on OODA Loop (Observe → Orient → Decide → Act)
 */
define(['N/log'], function(log) {
    'use strict';

    // ═══════════════════════════════════════════════════════════════════════════════
    // WORKING MEMORY
    // Persistent cognitive state that accumulates across iterations
    // ═══════════════════════════════════════════════════════════════════════════════
    
    /**
     * Create a new Working Memory instance
     * This is the "scratchpad" that persists across agent iterations
     */
    function createWorkingMemory(originalQuestion, plan) {
        return {
            // Original user question
            question: originalQuestion,
            
            // Current understanding of what user wants
            interpretedGoal: null,
            
            // Original plan from planner
            originalPlan: plan ? JSON.parse(JSON.stringify(plan)) : null,
            
            // Current plan (may be modified)
            currentPlan: plan ? JSON.parse(JSON.stringify(plan)) : null,
            
            // Hypotheses about the answer
            // { id, text, confidence (0-1), status: 'untested'|'supported'|'refuted'|'partial', evidence: [] }
            hypotheses: [],
            
            // Confirmed findings
            // { id, insight, source, importance: 'high'|'medium'|'low', confidence, iteration }
            findings: [],
            
            // Open questions that need investigation
            // { id, question, priority: 1-5, attempts: 0, status: 'open'|'answered'|'blocked' }
            openQuestions: [],
            
            // Data collected so far (summarized)
            // { stepNumber, type, summary, rowCount, keyValues }
            collectedData: [],
            
            // Entities discovered during analysis
            // { type, name, id, discovered_at_iteration }
            discoveredEntities: [],
            
            // Anomalies or unexpected findings
            // { type, description, severity, iteration, resolved }
            anomalies: [],
            
            // Overall confidence in current answer trajectory (0-1)
            overallConfidence: 0.5,
            
            // Reasoning trace for transparency
            reasoningTrace: [],
            
            // Iteration metadata
            currentIteration: 0,
            lastReflectionAt: 0,
            
            // Triggers that have fired
            triggeredReflections: []
        };
    }
    
    /**
     * Serialize working memory for inclusion in prompts
     */
    function serializeWorkingMemory(wm) {
        var lines = [];
        
        // Token budget management - compress older data
        var MAX_HYPOTHESES = 5;
        var MAX_EVIDENCE_PER_HYPOTHESIS = 2;
        var MAX_FINDINGS = 8;
        var MAX_COLLECTED_DATA_FULL = 3;  // Keep last 3 in full detail
        var MAX_ANOMALIES = 5;
        
        lines.push('═══════════════════════════════════════════════════════════════════════');
        lines.push('WORKING MEMORY (Your accumulated knowledge)');
        lines.push('═══════════════════════════════════════════════════════════════════════');
        
        // Goal understanding
        if (wm.interpretedGoal) {
            lines.push('\n📎 INTERPRETED GOAL:');
            lines.push(wm.interpretedGoal);
        }
        
        // Hypotheses - limit to most recent/important
        if (wm.hypotheses.length > 0) {
            lines.push('\n💡 HYPOTHESES:');
            // Sort by confidence descending, take top N
            var sortedHypotheses = wm.hypotheses.slice().sort(function(a, b) {
                return b.confidence - a.confidence;
            }).slice(0, MAX_HYPOTHESES);
            
            sortedHypotheses.forEach(function(h, i) {
                var statusIcon = h.status === 'supported' ? '✅' : 
                                 h.status === 'refuted' ? '❌' : 
                                 h.status === 'partial' ? '⚠️' : '❓';
                lines.push('  ' + (i + 1) + '. ' + statusIcon + ' [' + Math.round(h.confidence * 100) + '% confident] ' + h.text);
                // Limit evidence to save tokens
                if (h.evidence && h.evidence.length > 0) {
                    var evidenceToShow = h.evidence.slice(0, MAX_EVIDENCE_PER_HYPOTHESIS);
                    evidenceToShow.forEach(function(e) {
                        lines.push('     └─ Evidence: ' + e);
                    });
                    if (h.evidence.length > MAX_EVIDENCE_PER_HYPOTHESIS) {
                        lines.push('     └─ (+' + (h.evidence.length - MAX_EVIDENCE_PER_HYPOTHESIS) + ' more)');
                    }
                }
            });
            if (wm.hypotheses.length > MAX_HYPOTHESES) {
                lines.push('  (+' + (wm.hypotheses.length - MAX_HYPOTHESES) + ' more hypotheses)');
            }
        }
        
        // Confirmed findings - limit count
        if (wm.findings.length > 0) {
            lines.push('\n✅ CONFIRMED FINDINGS:');
            var findingsToShow = wm.findings.slice(-MAX_FINDINGS);  // Take most recent
            findingsToShow.forEach(function(f, i) {
                var importanceIcon = f.importance === 'high' ? '🔴' : 
                                     f.importance === 'medium' ? '🟡' : '🟢';
                lines.push('  ' + importanceIcon + ' ' + f.insight);
            });
            if (wm.findings.length > MAX_FINDINGS) {
                lines.push('  (+' + (wm.findings.length - MAX_FINDINGS) + ' more findings)');
            }
        }
        
        // Open questions - only show open ones, limit to 3
        var openQs = wm.openQuestions.filter(function(q) { return q.status === 'open'; }).slice(0, 3);
        if (openQs.length > 0) {
            lines.push('\n❓ OPEN QUESTIONS (need investigation):');
            openQs.forEach(function(q, i) {
                lines.push('  ' + (i + 1) + '. [Priority ' + q.priority + '] ' + q.question);
            });
        }
        
        // Data summary - compress older entries
        if (wm.collectedData.length > 0) {
            lines.push('\n📊 DATA COLLECTED:');
            
            if (wm.collectedData.length > MAX_COLLECTED_DATA_FULL) {
                // Summarize older data in one line
                var olderCount = wm.collectedData.length - MAX_COLLECTED_DATA_FULL;
                var olderTotalRows = wm.collectedData.slice(0, olderCount).reduce(function(sum, d) {
                    return sum + (d.rowCount || 0);
                }, 0);
                lines.push('  [Steps 1-' + olderCount + ': ' + olderCount + ' queries, ' + olderTotalRows + ' total rows - compressed]');
                
                // Show recent in full
                wm.collectedData.slice(-MAX_COLLECTED_DATA_FULL).forEach(function(d) {
                    lines.push('  Step ' + d.stepNumber + ': ' + d.summary + ' (' + d.rowCount + ' rows)');
                });
            } else {
                // Show all if under limit
                wm.collectedData.forEach(function(d) {
                    lines.push('  Step ' + d.stepNumber + ': ' + d.summary + ' (' + d.rowCount + ' rows)');
                });
            }
        }
        
        // Anomalies - limit count
        var unresolvedAnomalies = wm.anomalies.filter(function(a) { return !a.resolved; }).slice(0, MAX_ANOMALIES);
        if (unresolvedAnomalies.length > 0) {
            lines.push('\n⚠️ ANOMALIES (need attention):');
            unresolvedAnomalies.forEach(function(a) {
                lines.push('  • ' + a.description);
            });
        }
        
        // Overall confidence
        lines.push('\n📈 OVERALL CONFIDENCE: ' + Math.round(wm.overallConfidence * 100) + '%');
        
        lines.push('═══════════════════════════════════════════════════════════════════════');
        
        return lines.join('\n');
    }
    
    // ═══════════════════════════════════════════════════════════════════════════════
    // HYPOTHESIS MANAGEMENT
    // ═══════════════════════════════════════════════════════════════════════════════
    
    /**
     * Add a hypothesis to working memory
     */
    function addHypothesis(wm, text, initialConfidence) {
        var hypothesis = {
            id: 'H' + (wm.hypotheses.length + 1),
            text: text,
            confidence: initialConfidence || 0.5,
            status: 'untested',
            evidence: [],
            createdAt: wm.currentIteration
        };
        wm.hypotheses.push(hypothesis);
        
        wm.reasoningTrace.push({
            iteration: wm.currentIteration,
            action: 'hypothesis_added',
            detail: text
        });
        
        return hypothesis;
    }
    
    /**
     * Update hypothesis based on evidence
     */
    function updateHypothesis(wm, hypothesisId, newEvidence, confidenceChange, newStatus) {
        var hypothesis = wm.hypotheses.find(function(h) { return h.id === hypothesisId; });
        if (!hypothesis) return null;
        
        if (newEvidence) {
            hypothesis.evidence.push(newEvidence);
        }
        
        if (confidenceChange !== undefined) {
            hypothesis.confidence = Math.max(0, Math.min(1, hypothesis.confidence + confidenceChange));
        }
        
        if (newStatus) {
            hypothesis.status = newStatus;
        }
        
        wm.reasoningTrace.push({
            iteration: wm.currentIteration,
            action: 'hypothesis_updated',
            detail: hypothesisId + ': ' + (newStatus || 'confidence adjusted')
        });
        
        return hypothesis;
    }
    
    /**
     * Add a confirmed finding
     */
    function addFinding(wm, insight, source, importance, confidence) {
        var finding = {
            id: 'F' + (wm.findings.length + 1),
            insight: insight,
            source: source,
            importance: importance || 'medium',
            confidence: confidence || 0.8,
            iteration: wm.currentIteration
        };
        wm.findings.push(finding);
        
        // Increase overall confidence when we confirm findings
        wm.overallConfidence = Math.min(1, wm.overallConfidence + 0.1);
        
        wm.reasoningTrace.push({
            iteration: wm.currentIteration,
            action: 'finding_confirmed',
            detail: insight
        });
        
        return finding;
    }
    
    /**
     * Add an open question
     */
    function addOpenQuestion(wm, question, priority) {
        var q = {
            id: 'Q' + (wm.openQuestions.length + 1),
            question: question,
            priority: priority || 3,
            attempts: 0,
            status: 'open',
            createdAt: wm.currentIteration
        };
        wm.openQuestions.push(q);
        return q;
    }
    
    /**
     * Record an anomaly
     */
    function recordAnomaly(wm, type, description, severity) {
        var anomaly = {
            id: 'A' + (wm.anomalies.length + 1),
            type: type,
            description: description,
            severity: severity || 'medium',
            iteration: wm.currentIteration,
            resolved: false
        };
        wm.anomalies.push(anomaly);
        
        // Decrease confidence when anomalies are found
        wm.overallConfidence = Math.max(0, wm.overallConfidence - 0.15);
        
        wm.reasoningTrace.push({
            iteration: wm.currentIteration,
            action: 'anomaly_detected',
            detail: description
        });
        
        return anomaly;
    }
    
    // ═══════════════════════════════════════════════════════════════════════════════
    // REFLECTION TRIGGERS
    // Conditions that should automatically trigger deep reflection
    // ═══════════════════════════════════════════════════════════════════════════════
    
    var REFLECTION_TRIGGERS = {
        // Data triggers
        ZERO_ROWS: {
            id: 'zero_rows',
            name: 'Zero Rows Returned',
            description: 'Query returned no data - may need to adjust filters or verify entity exists',
            severity: 'high',
            check: function(context) {
                return context.lastQueryResult && 
                       context.lastQueryResult.success && 
                       context.lastQueryResult.rowCount === 0;
            }
        },
        
        UNEXPECTED_NEGATIVE: {
            id: 'unexpected_negative',
            name: 'Unexpected Negative Values',
            description: 'Found negative values where positive expected (e.g., revenue, quantities)',
            severity: 'medium',
            check: function(context) {
                if (!context.lastQueryResult || !context.lastQueryResult.rows) return false;
                var numericCols = ['amount', 'total', 'revenue', 'quantity', 'balance'];
                return context.lastQueryResult.rows.some(function(row) {
                    return numericCols.some(function(col) {
                        var val = row[col] || row[col.toUpperCase()];
                        return val !== undefined && val < 0;
                    });
                });
            }
        },
        
        SINGLE_ROW_AGGREGATION: {
            id: 'single_row_agg',
            name: 'Single Row from Aggregation',
            description: 'Aggregation query returned only 1 row - might be over-aggregating',
            severity: 'low',
            check: function(context) {
                if (!context.lastQueryResult || !context.lastQueryPurpose) return false;
                var aggKeywords = ['group', 'sum', 'count', 'average', 'by department', 'by customer'];
                var isAggQuery = aggKeywords.some(function(kw) {
                    return context.lastQueryPurpose.toLowerCase().includes(kw);
                });
                return isAggQuery && context.lastQueryResult.rowCount === 1;
            }
        },
        
        HYPOTHESIS_CONTRADICTED: {
            id: 'hypothesis_contradicted',
            name: 'Hypothesis Contradicted',
            description: 'Data contradicts a previous hypothesis - need to revise understanding',
            severity: 'high',
            check: function(context) {
                return context.hypothesisContradicted === true;
            }
        },
        
        // Progress triggers
        STALLED_PROGRESS: {
            id: 'stalled',
            name: 'Stalled Progress',
            description: 'Multiple iterations without new findings - may be stuck',
            severity: 'high',
            check: function(context) {
                var wm = context.workingMemory;
                if (!wm) return false;
                var iterationsSinceLastFinding = wm.currentIteration - 
                    (wm.findings.length > 0 ? wm.findings[wm.findings.length - 1].iteration : 0);
                return iterationsSinceLastFinding >= 3;
            }
        },
        
        LOW_CONFIDENCE: {
            id: 'low_confidence',
            name: 'Low Confidence',
            description: 'Overall confidence is low - need more evidence or different approach',
            severity: 'medium',
            check: function(context) {
                return context.workingMemory && 
                       context.workingMemory.overallConfidence < 0.3 &&
                       context.workingMemory.currentIteration >= 3;
            }
        },
        
        // Discovery triggers
        NEW_ENTITY_DISCOVERED: {
            id: 'new_entity',
            name: 'New Entity Discovered',
            description: 'Found an entity not in original plan - may need additional queries',
            severity: 'low',
            check: function(context) {
                return context.newEntityDiscovered === true;
            }
        },
        
        MISSING_PERIOD_DATA: {
            id: 'missing_period',
            name: 'Missing Period Data',
            description: 'One comparison period has no data while other does',
            severity: 'high',
            check: function(context) {
                if (!context.lastQueryResult || !context.comparisonContext) return false;
                return context.comparisonContext.onePeriodEmpty === true;
            }
        },
        
        QUERY_FAILURE: {
            id: 'query_failure',
            name: 'Query Failed',
            description: 'A query failed to execute - need to analyze error and adapt approach',
            severity: 'high',
            check: function(context) {
                return context.lastQueryResult && 
                       context.lastQueryResult.success === false;
            }
        },
        
        REPEATED_QUERY_FAILURE: {
            id: 'repeated_failure',
            name: 'Repeated Query Failures',
            description: 'Same query purpose has failed multiple times - need to significantly change approach',
            severity: 'high',
            check: function(context) {
                return context.repeatedFailure === true;
            }
        },
        
        DATE_SYNTAX_ERROR: {
            id: 'date_syntax_error',
            name: 'Date Syntax Error Detected',
            description: 'Query used incorrect date syntax - must use TO_DATE() for all date comparisons',
            severity: 'high',
            check: function(context) {
                return context.dateSyntaxError === true;
            }
        }
    };
    
    /**
     * Check all reflection triggers against current context
     * Returns array of triggered conditions
     */
    function checkReflectionTriggers(context) {
        var triggered = [];
        
        Object.keys(REFLECTION_TRIGGERS).forEach(function(key) {
            var trigger = REFLECTION_TRIGGERS[key];
            try {
                if (trigger.check(context)) {
                    triggered.push({
                        id: trigger.id,
                        name: trigger.name,
                        description: trigger.description,
                        severity: trigger.severity
                    });
                }
            } catch (e) {
                log.debug('Trigger check error', { trigger: key, error: e.message });
            }
        });
        
        return triggered;
    }
    
    /**
     * Determine if forced reflection is needed
     * Includes protection against reflection loops (same trigger firing repeatedly)
     */
    function shouldForceReflection(wm, context) {
        var triggers = checkReflectionTriggers(context);
        
        // Check for reflection loop - same trigger firing repeatedly
        var LOOKBACK_ITERATIONS = 2;
        var recentReflections = (wm.triggeredReflections || []).filter(function(r) {
            return r.iteration >= wm.currentIteration - LOOKBACK_ITERATIONS;
        });
        
        /**
         * Check if a trigger has fired recently
         */
        function hasTriggeredRecently(triggerId) {
            return recentReflections.some(function(r) {
                return (r.triggers || []).some(function(t) {
                    return t.id === triggerId;
                });
            });
        }
        
        // Filter out triggers that have already fired recently (prevent reflection loop)
        var newTriggers = triggers.filter(function(t) {
            return !hasTriggeredRecently(t.id);
        });
        
        // If all triggers have already fired recently, we're in a reflection loop
        if (triggers.length > 0 && newTriggers.length === 0) {
            log.debug('Reflection loop detected - all triggers have fired recently', {
                triggersCount: triggers.length,
                triggerIds: triggers.map(function(t) { return t.id; }),
                recentReflectionsCount: recentReflections.length
            });
            return { 
                force: false, 
                triggers: triggers, 
                reflectionExhausted: true,
                reason: 'Reflection exhausted - same issues detected repeatedly. Proceed to final_response with available data.'
            };
        }
        
        // Always reflect on high-severity triggers (if they haven't fired recently)
        var highSeverity = newTriggers.filter(function(t) { return t.severity === 'high'; });
        if (highSeverity.length > 0) {
            return { force: true, triggers: highSeverity, reason: 'High-severity trigger detected' };
        }
        
        // Reflect if multiple medium triggers (if they haven't fired recently)
        var mediumSeverity = newTriggers.filter(function(t) { return t.severity === 'medium'; });
        if (mediumSeverity.length >= 2) {
            return { force: true, triggers: mediumSeverity, reason: 'Multiple medium-severity triggers' };
        }
        
        // Reflect every 3 iterations minimum
        if (wm.currentIteration - wm.lastReflectionAt >= 3) {
            return { force: true, triggers: newTriggers, reason: 'Periodic reflection (3 iterations)' };
        }
        
        return { force: false, triggers: triggers };
    }
    
    // ═══════════════════════════════════════════════════════════════════════════════
    // DEEP THINKING TOOL
    // Extended reasoning for complex analysis
    // ═══════════════════════════════════════════════════════════════════════════════
    
    var DEEP_THINK_TOOL = {
        name: 'deep_think',
        description: `EXTENDED REASONING: Use for complex analysis requiring careful thought.

Unlike quick 'think' tool, deep_think is for:
• Synthesizing multiple data sources
• Forming and testing hypotheses
• Resolving contradictions in data
• Planning complex multi-step investigations
• Making high-stakes conclusions

The system will record your reasoning in working memory.`,
        parameters: {
            type: 'object',
            properties: {
                thinking_type: {
                    type: 'string',
                    enum: ['synthesize', 'hypothesize', 'investigate', 'resolve_contradiction', 'conclude'],
                    description: 'Type of thinking: synthesize (combine data), hypothesize (form theory), investigate (plan queries), resolve_contradiction (fix conflicts), conclude (final answer)'
                },
                context_summary: {
                    type: 'string',
                    description: 'Brief summary of relevant context (what you know, what you need)'
                },
                reasoning_steps: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Step-by-step reasoning (each step should be a clear logical progression)'
                },
                hypotheses: {
                    type: 'array',
                    description: 'Hypotheses to form or update',
                    items: {
                        type: 'object',
                        properties: {
                            text: { type: 'string', description: 'The hypothesis' },
                            confidence: { type: 'number', description: 'Confidence 0-1' },
                            action: { 
                                type: 'string', 
                                enum: ['add', 'support', 'refute', 'partial'],
                                description: 'What to do with this hypothesis'
                            },
                            hypothesis_id: { type: 'string', description: 'For updates: existing hypothesis ID' },
                            evidence: { type: 'string', description: 'Evidence supporting/refuting' }
                        },
                        required: ['text', 'action']
                    }
                },
                findings: {
                    type: 'array',
                    description: 'Confirmed findings to record',
                    items: {
                        type: 'object',
                        properties: {
                            insight: { type: 'string', description: 'The finding' },
                            importance: { type: 'string', enum: ['high', 'medium', 'low'] },
                            source: { type: 'string', description: 'Which data/step supports this' }
                        },
                        required: ['insight']
                    }
                },
                open_questions: {
                    type: 'array',
                    description: 'Questions that need investigation',
                    items: {
                        type: 'object',
                        properties: {
                            question: { type: 'string' },
                            priority: { type: 'integer', minimum: 1, maximum: 5 }
                        },
                        required: ['question']
                    }
                },
                plan_revision: {
                    type: 'object',
                    description: 'If plan needs to change',
                    properties: {
                        reason: { type: 'string', description: 'Why plan needs revision' },
                        add_steps: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    action: { type: 'string', enum: ['query', 'template', 'dashboard'] },
                                    purpose: { type: 'string' },
                                    sql: { type: 'string' }
                                }
                            }
                        },
                        skip_steps: {
                            type: 'array',
                            items: { type: 'integer' },
                            description: 'Step numbers to skip (1-based)'
                        },
                        reorder: {
                            type: 'array',
                            items: { type: 'integer' },
                            description: 'New step order'
                        }
                    }
                },
                confidence_assessment: {
                    type: 'object',
                    properties: {
                        overall: { type: 'number', description: 'Overall confidence 0-1' },
                        reasoning: { type: 'string', description: 'Why this confidence level' }
                    }
                },
                next_action: {
                    type: 'string',
                    enum: ['continue_plan', 'execute_query', 'ask_user', 'finalize'],
                    description: 'What to do after thinking'
                },
                immediate_query: {
                    type: 'object',
                    description: 'If next_action is execute_query',
                    properties: {
                        sql: { type: 'string' },
                        purpose: { type: 'string' }
                    }
                },
                conclusion: {
                    type: 'string',
                    description: 'If next_action is finalize: the final answer'
                }
            },
            required: ['thinking_type', 'reasoning_steps', 'next_action']
        }
    };
    
    /**
     * Process deep_think tool call and update working memory
     */
    function processDeepThink(wm, args) {
        var result = {
            processed: true,
            workingMemoryUpdates: [],
            planChanges: null,
            immediateAction: null
        };
        
        // Record the thinking in trace
        wm.reasoningTrace.push({
            iteration: wm.currentIteration,
            action: 'deep_think',
            type: args.thinking_type,
            steps: args.reasoning_steps
        });
        
        // Process hypotheses
        if (args.hypotheses && args.hypotheses.length > 0) {
            args.hypotheses.forEach(function(h) {
                if (h.action === 'add') {
                    var newH = addHypothesis(wm, h.text, h.confidence || 0.5);
                    result.workingMemoryUpdates.push('Added hypothesis: ' + newH.id);
                } else if (h.hypothesis_id) {
                    var confidenceChange = 0;
                    if (h.action === 'support') confidenceChange = 0.2;
                    else if (h.action === 'refute') confidenceChange = -0.3;
                    else if (h.action === 'partial') confidenceChange = 0.1;
                    
                    var status = h.action === 'refute' ? 'refuted' : 
                                 h.action === 'support' ? 'supported' : 'partial';
                    
                    updateHypothesis(wm, h.hypothesis_id, h.evidence, confidenceChange, status);
                    result.workingMemoryUpdates.push('Updated hypothesis: ' + h.hypothesis_id);
                }
            });
        }
        
        // Process findings
        if (args.findings && args.findings.length > 0) {
            args.findings.forEach(function(f) {
                addFinding(wm, f.insight, f.source || 'deep_think', f.importance || 'medium');
                result.workingMemoryUpdates.push('Added finding: ' + f.insight.substring(0, 50));
            });
        }
        
        // Process open questions
        if (args.open_questions && args.open_questions.length > 0) {
            args.open_questions.forEach(function(q) {
                addOpenQuestion(wm, q.question, q.priority || 3);
                result.workingMemoryUpdates.push('Added question: ' + q.question.substring(0, 50));
            });
        }
        
        // Process plan revision
        if (args.plan_revision) {
            result.planChanges = args.plan_revision;
            
            if (args.plan_revision.add_steps) {
                if (!wm.currentPlan.added_steps) wm.currentPlan.added_steps = [];
                args.plan_revision.add_steps.forEach(function(s) {
                    wm.currentPlan.added_steps.push(s);
                });
            }
            
            if (args.plan_revision.skip_steps) {
                if (!wm.currentPlan.skipped_steps) wm.currentPlan.skipped_steps = [];
                args.plan_revision.skip_steps.forEach(function(n) {
                    if (wm.currentPlan.skipped_steps.indexOf(n) === -1) {
                        wm.currentPlan.skipped_steps.push(n);
                    }
                });
            }
            
            wm.reasoningTrace.push({
                iteration: wm.currentIteration,
                action: 'plan_revised',
                reason: args.plan_revision.reason
            });
        }
        
        // Update confidence
        if (args.confidence_assessment) {
            wm.overallConfidence = args.confidence_assessment.overall;
            wm.reasoningTrace.push({
                iteration: wm.currentIteration,
                action: 'confidence_updated',
                value: args.confidence_assessment.overall,
                reason: args.confidence_assessment.reasoning
            });
        }
        
        // Determine immediate action
        if (args.next_action === 'execute_query' && args.immediate_query) {
            result.immediateAction = {
                type: 'query',
                sql: args.immediate_query.sql,
                purpose: args.immediate_query.purpose
            };
        } else if (args.next_action === 'finalize' && args.conclusion) {
            result.immediateAction = {
                type: 'finalize',
                conclusion: args.conclusion
            };
        } else if (args.next_action === 'ask_user') {
            result.immediateAction = {
                type: 'ask_user'
            };
        }
        
        wm.lastReflectionAt = wm.currentIteration;
        
        return result;
    }
    
    // ═══════════════════════════════════════════════════════════════════════════════
    // INVESTIGATION PLANNING
    // Build optimal query sequences based on what we know
    // ═══════════════════════════════════════════════════════════════════════════════
    
    /**
     * Suggest next investigation step based on working memory state
     */
    function suggestNextStep(wm) {
        // Priority 1: Address high-severity anomalies
        var unresolvedAnomalies = wm.anomalies.filter(function(a) { 
            return !a.resolved && a.severity === 'high'; 
        });
        if (unresolvedAnomalies.length > 0) {
            return {
                type: 'investigate_anomaly',
                target: unresolvedAnomalies[0],
                reasoning: 'High-severity anomaly needs resolution before proceeding'
            };
        }
        
        // Priority 2: Answer high-priority open questions
        var highPriorityQs = wm.openQuestions.filter(function(q) {
            return q.status === 'open' && q.priority >= 4 && q.attempts < 2;
        });
        if (highPriorityQs.length > 0) {
            return {
                type: 'answer_question',
                target: highPriorityQs[0],
                reasoning: 'High-priority question needs investigation'
            };
        }
        
        // Priority 3: Test untested hypotheses
        var untestedH = wm.hypotheses.filter(function(h) { return h.status === 'untested'; });
        if (untestedH.length > 0) {
            return {
                type: 'test_hypothesis',
                target: untestedH[0],
                reasoning: 'Hypothesis needs testing with data'
            };
        }
        
        // Priority 4: Continue with plan
        if (wm.currentPlan && wm.currentPlan.plan) {
            var completedSteps = wm.collectedData.length;
            var totalSteps = wm.currentPlan.plan.length;
            if (completedSteps < totalSteps) {
                return {
                    type: 'continue_plan',
                    nextStep: wm.currentPlan.plan[completedSteps],
                    stepNumber: completedSteps + 1,
                    reasoning: 'Continuing with planned step ' + (completedSteps + 1) + ' of ' + totalSteps
                };
            }
        }
        
        // Priority 5: Ready to synthesize
        if (wm.findings.length > 0 || wm.collectedData.length > 0) {
            return {
                type: 'synthesize',
                reasoning: 'All planned steps complete, ready to synthesize findings'
            };
        }
        
        return {
            type: 'stuck',
            reasoning: 'No clear next step - may need user clarification'
        };
    }
    
    // ═══════════════════════════════════════════════════════════════════════════════
    // CONFIDENCE CALCULATION
    // ═══════════════════════════════════════════════════════════════════════════════
    
    /**
     * Calculate overall confidence based on working memory state
     */
    function calculateConfidence(wm) {
        var score = 0.5; // Start neutral
        
        // Positive factors
        score += wm.findings.length * 0.1; // Each finding adds confidence
        score += wm.hypotheses.filter(function(h) { return h.status === 'supported'; }).length * 0.1;
        score += wm.collectedData.length * 0.05; // Data collection adds confidence
        
        // Negative factors
        score -= wm.anomalies.filter(function(a) { return !a.resolved; }).length * 0.15;
        score -= wm.hypotheses.filter(function(h) { return h.status === 'refuted'; }).length * 0.1;
        score -= wm.openQuestions.filter(function(q) { return q.status === 'open' && q.priority >= 4; }).length * 0.1;
        
        // Clamp to 0-1
        return Math.max(0, Math.min(1, score));
    }
    
    // ═══════════════════════════════════════════════════════════════════════════════
    // EXPORTS
    // ═══════════════════════════════════════════════════════════════════════════════
    
    return {
        // Working Memory
        createWorkingMemory: createWorkingMemory,
        serializeWorkingMemory: serializeWorkingMemory,
        
        // Hypothesis Management
        addHypothesis: addHypothesis,
        updateHypothesis: updateHypothesis,
        addFinding: addFinding,
        addOpenQuestion: addOpenQuestion,
        recordAnomaly: recordAnomaly,
        
        // Reflection
        REFLECTION_TRIGGERS: REFLECTION_TRIGGERS,
        checkReflectionTriggers: checkReflectionTriggers,
        shouldForceReflection: shouldForceReflection,
        
        // Deep Thinking
        DEEP_THINK_TOOL: DEEP_THINK_TOOL,
        processDeepThink: processDeepThink,
        
        // Planning
        suggestNextStep: suggestNextStep,
        calculateConfidence: calculateConfidence
    };
});