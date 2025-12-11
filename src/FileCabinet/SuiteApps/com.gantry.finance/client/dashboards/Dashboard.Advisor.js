/**
 * Dashboard.Advisor.js
 * Premium AI Financial Advisor Interface
 * 
 * Features:
 * - Transparent tool call steps (collapsible)
 * - Progressive message rendering
 * - Model/provider display
 * - Session persistence
 * - Responsive & accessible
 */
(function(window) {
    'use strict';

    // Constants
    const STORAGE_KEY = 'gantry_advisor_session';
    const MAX_HISTORY = 50;
    
    // State
    let messages = [];
    let isProcessing = false;
    let sessionContext = { 
        resolvedEntities: {},
        entityOrder: [],      // Tracks chronological order of entity mentions for pronoun resolution
        topics: [],           // Conversation topics for context
        queryHistory: []      // Recent query history
    };  // Persists entity resolutions and context across messages

    /**
     * Advisor Controller
     */
    const AdvisorController = {
        
        /**
         * Initialize the advisor dashboard
         */
        init: function() {
            // Don't reset processing state if already processing
            const wasProcessing = isProcessing;
            
            messages = messages || [];
            
            const container = document.getElementById('gantry-view-container');
            const tpl = document.getElementById('tpl-advisor');
            
            if (!tpl) {
                console.error('[Advisor] Template not found');
                return;
            }
            
            container.innerHTML = tpl.innerHTML;
            
            // Add dynamic CSS for metric labels and charts
            this.injectDynamicStyles();
            
            // Hide floating panel if exists
            const fab = document.getElementById('advisor-fab');
            const panel = document.getElementById('advisor-panel');
            if (fab) fab.style.display = 'none';
            if (panel) panel.classList.remove('open');
            
            this.loadSession();
            this.renderCategories(); // Render category buttons dynamically
            this.bindEvents();
            this.renderAllMessages();
            
            // Restore thinking indicator if we were processing
            if (wasProcessing) {
                this.showThinking();
                this.updateSendButton(true);
            }
            
            console.log('[Advisor] Initialized');
        },
        
        /**
         * Inject dynamic styles for advisor components
         */
        injectDynamicStyles: function() {
            if (document.getElementById('advisor-dynamic-styles')) return;
            
            const style = document.createElement('style');
            style.id = 'advisor-dynamic-styles';
            style.textContent = `
                /* Metric label size variants */
                .metric-label-sm {
                    font-size: 0.65rem !important;
                    line-height: 1.2;
                }
                .metric-label-xs {
                    font-size: 0.55rem !important;
                    line-height: 1.2;
                }
                
                /* Ensure metric cards have equal sizing */
                .message-rich .metric-row .metric-card {
                    flex: 1 1 0;
                    min-width: 0;
                    max-width: 200px;
                }
                
                /* Chart empty state */
                .chart-empty {
                    padding: 20px;
                    text-align: center;
                    color: #64748b;
                    font-style: italic;
                }
                
                /* Bar chart label styling */
                .bar-chart .bar-label {
                    font-size: 11px;
                    fill: #374151;
                }
                .bar-chart .bar-value {
                    font-size: 11px;
                    fill: #6b7280;
                }
                body.dark-mode .bar-chart .bar-label,
                body.dark-mode .bar-chart .bar-value {
                    fill: #d1d5db;
                }
                
                /* Fix duplicate entity step display */
                .tool-call-content .duplicate-note {
                    color: #9ca3af;
                    font-style: italic;
                    font-size: 0.85em;
                }
                
                /* ═══════════════════════════════════════════════════════════════
                   TABLE STYLES - Scroll, Grand Total, Group Headers
                   ═══════════════════════════════════════════════════════════════ */
                
                /* Horizontal scroll for wide tables */
                .table-scroll-wrapper {
                    overflow-x: auto;
                    max-width: 100%;
                    -webkit-overflow-scrolling: touch;
                }
                
                .table-scroll-wrapper::-webkit-scrollbar {
                    height: 8px;
                }
                
                .table-scroll-wrapper::-webkit-scrollbar-track {
                    background: #f1f5f9;
                    border-radius: 4px;
                }
                
                .table-scroll-wrapper::-webkit-scrollbar-thumb {
                    background: #cbd5e1;
                    border-radius: 4px;
                }
                
                body.dark-mode .table-scroll-wrapper::-webkit-scrollbar-track {
                    background: #1e293b;
                }
                
                body.dark-mode .table-scroll-wrapper::-webkit-scrollbar-thumb {
                    background: #475569;
                }
                
                /* Advisor table wrapper horizontal scroll */
                .advisor-table-wrapper {
                    overflow-x: auto;
                    max-width: 100%;
                    -webkit-overflow-scrolling: touch;
                }
                
                /* Grand Total Row - Light Mode */
                .grand-total-row {
                    background: #334155 !important;
                    color: white !important;
                    font-weight: 600 !important;
                }
                
                .grand-total-row td {
                    background: #334155 !important;
                    color: white !important;
                    border-color: #475569 !important;
                }
                
                /* Grand Total Row - Dark Mode */
                body.dark-mode .grand-total-row {
                    background: #0f172a !important;
                    color: #f1f5f9 !important;
                }
                
                body.dark-mode .grand-total-row td {
                    background: #0f172a !important;
                    color: #f1f5f9 !important;
                    border-color: #334155 !important;
                }
                
                /* Group Header Row - Light Mode */
                .group-header {
                    background: #f1f5f9 !important;
                    cursor: pointer;
                }
                
                .group-header td {
                    background: #f1f5f9 !important;
                    color: #1e293b !important;
                    font-weight: 600;
                    padding: 10px !important;
                }
                
                .group-header .group-count,
                .group-header span[style*="color: #64748b"] {
                    color: #64748b !important;
                }
                
                /* Group Header Row - Dark Mode */
                body.dark-mode .group-header {
                    background: #1e293b !important;
                }
                
                body.dark-mode .group-header td {
                    background: #1e293b !important;
                    color: #f1f5f9 !important;
                }
                
                body.dark-mode .group-header .group-count,
                body.dark-mode .group-header span[style*="color: #64748b"] {
                    color: #94a3b8 !important;
                }
                
                /* Collapsed group header chevron rotation */
                .group-header.collapsed .chevron,
                .group-header.collapsed i.fa-chevron-down {
                    transform: rotate(-90deg);
                }
                
                /* Subtotal row styling */
                .subtotal-row {
                    background: #f8fafc !important;
                    font-style: italic;
                    border-top: 1px solid #e2e8f0;
                }
                
                body.dark-mode .subtotal-row {
                    background: #0f172a !important;
                    border-top-color: #334155;
                }
                
                /* Calculated total rows (Gross Profit, Net Income) */
                .calculated-total-row {
                    background: #e2e8f0 !important;
                    font-weight: 600;
                }
                
                .calculated-total-row.grand {
                    background: #334155 !important;
                    color: white !important;
                }
                
                body.dark-mode .calculated-total-row {
                    background: #1e293b !important;
                }
                
                body.dark-mode .calculated-total-row.grand {
                    background: #0f172a !important;
                    color: #f1f5f9 !important;
                }
                
                /* Show More button for truncated tables */
                .show-more-row {
                    background: #f8fafc !important;
                }
                
                .show-more-btn {
                    background: #e2e8f0;
                    border: 1px solid #cbd5e1;
                    border-radius: 6px;
                    padding: 8px 16px;
                    font-size: 13px;
                    color: #475569;
                    cursor: pointer;
                    transition: all 0.15s ease;
                    display: inline-flex;
                    align-items: center;
                    gap: 6px;
                }
                
                .show-more-btn:hover {
                    background: #cbd5e1;
                    color: #1e293b;
                }
                
                .show-more-btn i {
                    font-size: 11px;
                }
                
                body.dark-mode .show-more-row {
                    background: #1e293b !important;
                }
                
                body.dark-mode .show-more-btn {
                    background: #334155;
                    border-color: #475569;
                    color: #94a3b8;
                }
                
                body.dark-mode .show-more-btn:hover {
                    background: #475569;
                    color: #f1f5f9;
                }
                
                /* ═══════════════════════════════════════════════════════════════════
                   FINANCIAL STATEMENT STYLES (Income Statement, Balance Sheet)
                   ═══════════════════════════════════════════════════════════════════ */
                
                .financial-statement-container {
                    background: white;
                    border: 1px solid #e2e8f0;
                    border-radius: 8px;
                    overflow: hidden;
                    margin: 16px 0;
                }
                
                body.dark-mode .financial-statement-container {
                    background: #1e293b;
                    border-color: #334155;
                }
                
                /* Statement Header */
                .fs-header {
                    text-align: center;
                    padding: 20px 24px 16px;
                    border-bottom: 2px solid #cbd5e1;
                    background: linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%);
                }
                
                body.dark-mode .fs-header {
                    background: linear-gradient(180deg, #1e293b 0%, #0f172a 100%);
                    border-color: #475569;
                }
                
                .fs-title {
                    font-size: 18px;
                    font-weight: 700;
                    color: #1e293b;
                    text-transform: uppercase;
                    letter-spacing: 0.05em;
                    margin-bottom: 4px;
                }
                
                body.dark-mode .fs-title {
                    color: #f1f5f9;
                }
                
                .fs-date-range {
                    font-size: 13px;
                    color: #64748b;
                    font-style: italic;
                }
                
                body.dark-mode .fs-date-range {
                    color: #94a3b8;
                }
                
                /* Financial Statement Tables */
                .income-statement,
                .balance-sheet {
                    width: 100%;
                    border-collapse: collapse;
                    font-size: 13px;
                }
                
                .income-statement thead th,
                .balance-sheet thead th {
                    background: #f8fafc;
                    padding: 12px 16px;
                    font-weight: 600;
                    color: #475569;
                    text-transform: uppercase;
                    font-size: 11px;
                    letter-spacing: 0.05em;
                    border-bottom: 2px solid #e2e8f0;
                }
                
                body.dark-mode .income-statement thead th,
                body.dark-mode .balance-sheet thead th {
                    background: #0f172a;
                    color: #94a3b8;
                    border-color: #334155;
                }
                
                /* Section Headers */
                .fs-section-header {
                    background: #f1f5f9;
                    cursor: pointer;
                    transition: background 0.15s ease;
                }
                
                .fs-section-header:hover {
                    background: #e2e8f0;
                }
                
                body.dark-mode .fs-section-header {
                    background: #334155;
                }
                
                body.dark-mode .fs-section-header:hover {
                    background: #475569;
                }
                
                .fs-section-header td {
                    padding: 10px 16px;
                    font-weight: 700;
                    color: #1e293b;
                    text-transform: uppercase;
                    font-size: 12px;
                    letter-spacing: 0.03em;
                }
                
                body.dark-mode .fs-section-header td {
                    color: #e2e8f0;
                }
                
                .fs-section-header .chevron {
                    margin-right: 8px;
                    transition: transform 0.2s ease;
                    font-size: 10px;
                    color: #64748b;
                }
                
                .fs-section-header.collapsed .chevron {
                    transform: rotate(-90deg);
                }
                
                /* Account Rows */
                .fs-account-row td {
                    padding: 8px 16px;
                    border-bottom: 1px solid #f1f5f9;
                    color: #334155;
                }
                
                body.dark-mode .fs-account-row td {
                    border-color: #334155;
                    color: #cbd5e1;
                }
                
                .fs-account-row:hover {
                    background: #f8fafc;
                }
                
                body.dark-mode .fs-account-row:hover {
                    background: #1e293b;
                }
                
                /* Section Subtotals */
                .fs-section-subtotal {
                    background: #f8fafc;
                    border-top: 1px solid #e2e8f0;
                }
                
                body.dark-mode .fs-section-subtotal {
                    background: #1e293b;
                    border-color: #475569;
                }
                
                .fs-section-subtotal td {
                    padding: 10px 16px;
                    font-weight: 600;
                    color: #1e293b;
                    font-style: italic;
                }
                
                body.dark-mode .fs-section-subtotal td {
                    color: #e2e8f0;
                }
                
                .fs-subtotal-label {
                    padding-left: 32px !important;
                }
                
                /* Calculated Rows (Gross Profit, Net Income) */
                .fs-calculated-row {
                    background: #e2e8f0;
                    border-top: 2px solid #cbd5e1;
                }
                
                body.dark-mode .fs-calculated-row {
                    background: #334155;
                    border-color: #475569;
                }
                
                .fs-calculated-row td {
                    padding: 12px 16px;
                    font-weight: 700;
                    color: #1e293b;
                }
                
                body.dark-mode .fs-calculated-row td {
                    color: #f1f5f9;
                }
                
                .fs-calculated-row.grand {
                    background: #1e293b;
                    border-top: 3px double #475569;
                }
                
                .fs-calculated-row.grand td {
                    color: white;
                    font-size: 14px;
                }
                
                body.dark-mode .fs-calculated-row.grand {
                    background: #0f172a;
                    border-color: #64748b;
                }
                
                .fs-calc-label {
                    text-transform: uppercase;
                    letter-spacing: 0.03em;
                }
                
                /* Negative Values (Parentheses) */
                .fs-negative {
                    color: #dc2626;
                }
                
                body.dark-mode .fs-negative {
                    color: #f87171;
                }
                
                
                /* ═══════════════════════════════════════════════════════════════════
                   PROFESSIONAL PAPER-STYLE FINANCIAL STATEMENTS
                   ═══════════════════════════════════════════════════════════════════ */
                
                .fs-paper {
                    background: linear-gradient(to bottom, #fefefe 0%, #fafafa 100%);
                    border: 1px solid #d1d5db;
                    border-radius: 4px;
                    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08), 0 1px 3px rgba(0, 0, 0, 0.04);
                    margin: 20px auto;
                    max-width: 700px;
                    font-family: 'Georgia', 'Times New Roman', serif;
                }
                
                body.dark-mode .fs-paper {
                    background: linear-gradient(to bottom, #1e293b 0%, #0f172a 100%);
                    border-color: #334155;
                    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
                }
                
                .fs-paper-header {
                    text-align: center;
                    padding: 32px 40px 24px;
                    border-bottom: 2px solid #1e293b;
                }
                
                body.dark-mode .fs-paper-header {
                    border-color: #94a3b8;
                }
                
                .fs-company-name {
                    font-size: 22px;
                    font-weight: 700;
                    color: #1e293b;
                    letter-spacing: 0.02em;
                    margin-bottom: 6px;
                }
                
                body.dark-mode .fs-company-name {
                    color: #f1f5f9;
                }
                
                .fs-period {
                    font-size: 14px;
                    color: #64748b;
                    font-style: italic;
                }
                
                body.dark-mode .fs-period {
                    color: #94a3b8;
                }
                
                .fs-paper-body {
                    padding: 24px 40px 32px;
                }
                
                .fs-statement-table {
                    width: 100%;
                    border-collapse: collapse;
                    font-size: 14px;
                }
                
                /* Section styling */
                .fs-section {
                    border-bottom: 1px solid #e2e8f0;
                }
                
                body.dark-mode .fs-section {
                    border-color: #334155;
                }
                
                .fs-section-title td {
                    padding: 16px 0 8px;
                    font-weight: 700;
                    font-size: 13px;
                    color: #1e293b;
                    text-transform: uppercase;
                    letter-spacing: 0.04em;
                    border-bottom: 1px solid #cbd5e1;
                }
                
                body.dark-mode .fs-section-title td {
                    color: #e2e8f0;
                    border-color: #475569;
                }
                
                /* Account lines */
                .fs-account-line td {
                    padding: 6px 0;
                    color: #334155;
                }
                
                body.dark-mode .fs-account-line td {
                    color: #cbd5e1;
                }
                
                .fs-account-name {
                    padding-left: 24px !important;
                }
                
                .fs-account-amount {
                    text-align: right;
                    font-variant-numeric: tabular-nums;
                    white-space: nowrap;
                }
                
                /* Section totals */
                .fs-section-total td {
                    padding: 10px 0;
                    font-weight: 600;
                    color: #1e293b;
                }
                
                body.dark-mode .fs-section-total td {
                    color: #f1f5f9;
                }
                
                .fs-total-label {
                    padding-left: 24px !important;
                    font-style: italic;
                }
                
                .fs-total-amount {
                    text-align: right;
                    border-top: 1px solid #94a3b8;
                    font-variant-numeric: tabular-nums;
                }
                
                body.dark-mode .fs-total-amount {
                    border-color: #64748b;
                }
                
                /* Calculated rows (Gross Profit, Net Income) */
                .fs-calculated {
                    background: transparent;
                }
                
                .fs-gross-profit td {
                    padding: 14px 0;
                    font-weight: 700;
                    font-size: 15px;
                    color: #1e293b;
                    border-top: 2px solid #475569;
                    border-bottom: 2px solid #475569;
                }
                
                body.dark-mode .fs-gross-profit td {
                    color: #f1f5f9;
                    border-color: #64748b;
                }
                
                .fs-gross-profit .fs-calc-amount {
                    text-align: right;
                    font-variant-numeric: tabular-nums;
                }
                
                .fs-net-income td {
                    padding: 16px 0;
                    font-weight: 700;
                    font-size: 16px;
                    color: #1e293b;
                    border-top: 3px double #1e293b;
                }
                
                body.dark-mode .fs-net-income td {
                    color: #f1f5f9;
                    border-color: #94a3b8;
                }
                
                .fs-net-income .fs-calc-amount {
                    text-align: right;
                    font-variant-numeric: tabular-nums;
                }
                
                .fs-calc-label {
                    text-transform: uppercase;
                    letter-spacing: 0.03em;
                }
                
                .fs-calc-amount {
                    text-align: right;
                }
                
                /* Print Styles */
                @media print {
                    .financial-statement-container {
                        border: none;
                        box-shadow: none;
                    }
                    
                    .fs-header {
                        background: white !important;
                        -webkit-print-color-adjust: exact;
                    }
                    
                    .fs-section-header .chevron {
                        display: none;
                    }
                    
                    .fs-section-rows {
                        display: table-row-group !important;
                    }
                }
            `;
            document.head.appendChild(style);
        },
        
        /**
         * Render category buttons dynamically from queryCategories
         */
        renderCategories: function() {
            const container = document.getElementById('query-categories');
            if (!container) return;
            
            const categories = this.queryCategories;
            let html = '';
            
            for (const [id, cat] of Object.entries(categories)) {
                html += `
                    <button class="query-category-btn" data-category="${id}">
                        <div class="category-icon" style="background: ${cat.color};">
                            <i class="fas ${cat.icon}"></i>
                        </div>
                        <span>${this.escapeHtml(cat.name)}</span>
                    </button>
                `;
            }
            
            container.innerHTML = html;
        },
        
        /**
         * Cleanup when leaving advisor
         */
        cleanup: function() {
            const fab = document.getElementById('advisor-fab');
            if (fab) fab.style.display = '';
        },
        
        /**
         * Bind all event listeners
         */
        bindEvents: function() {
            const self = this;
            
            // Send button
            const sendBtn = document.getElementById('advisor-send-full');
            if (sendBtn) {
                sendBtn.addEventListener('click', () => self.sendMessage());
            }
            
            // Input field
            const input = document.getElementById('advisor-input-full');
            if (input) {
                // Enter to send (shift+enter for newline)
                input.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        self.sendMessage();
                    }
                });
                
                // Auto-resize textarea
                input.addEventListener('input', () => {
                    input.style.height = 'auto';
                    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
                });
                
                // Focus input
                setTimeout(() => input.focus(), 100);
            }
            
            // Query category buttons
            document.querySelectorAll('.query-category-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const categoryId = btn.getAttribute('data-category');
                    self.showCategoryQueries(categoryId);
                });
            });
            
            // Back button in query panel
            const backBtn = document.getElementById('query-panel-back');
            if (backBtn) {
                backBtn.addEventListener('click', () => self.hideCategoryQueries());
            }
            
            // Suggestion chips (legacy, keep for compatibility)
            document.querySelectorAll('.suggestion-chip').forEach(chip => {
                chip.addEventListener('click', () => {
                    const question = chip.getAttribute('data-question');
                    if (question && input) {
                        input.value = question;
                        input.style.height = 'auto';
                        self.sendMessage().then(() => {
                            input.value = '';
                            input.style.height = 'auto';
                        });
                    }
                });
            });
            
            // Clear chat button
            const clearBtn = document.getElementById('advisorClearChat');
            if (clearBtn) {
                clearBtn.addEventListener('click', () => self.clearChat());
            }
        },
        
        /**
         * Get settings from storage or defaults
         */
        getSettings: function() {
            try {
                const stored = localStorage.getItem('gantry_advisor_settings');
                return stored ? JSON.parse(stored) : { aiMode: 'smart' };
            } catch (e) {
                return { aiMode: 'smart' };
            }
        },
        
        /**
         * Save settings to storage
         */
        saveSettings: function(settings) {
            try {
                localStorage.setItem('gantry_advisor_settings', JSON.stringify(settings));
            } catch (e) {
                console.error('Failed to save settings', e);
            }
        },
        
        /**
         * Query categories data - organized by template categories
         * Maps to actual templates in Lib_Advisor_Templates.js
         */
        queryCategories: {
            financials: {
                name: 'Financial Statements',
                icon: 'fa-file-invoice-dollar',
                color: 'linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%)',
                queries: [
                    { text: 'Income Statement', question: 'Show the full income statement' },
                    { text: 'Balance Sheet', question: 'Show balance sheet' },
                    { text: 'Trial Balance', question: 'Show trial balance YTD' },
                    { text: 'Department P&L', question: 'Show P&L for ', prefill: true, placeholder: 'Enter department name' },
                    { text: 'Comparative P&L', question: 'Show comparative P&L this year vs last year' }
                ]
            },
            cash: {
                name: 'Cash & Liquidity',
                icon: 'fa-coins',
                color: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                queries: [
                    { text: 'Cash position', question: "What's our current cash position?" },
                    { text: 'Bank balances', question: 'Show all bank account balances' },
                    { text: 'Cash forecast', question: 'What will our cash position be in 30 days?' },
                    { text: 'Cash runway', question: 'How many months of runway do we have?' }
                ]
            },
            ar: {
                name: 'Accounts Receivable',
                icon: 'fa-hand-holding-usd',
                color: 'linear-gradient(135deg, #06b6d4 0%, #0891b2 100%)',
                queries: [
                    { text: 'AR Aging Summary', question: 'Show AR aging summary' },
                    { text: 'AR Aging Detail', question: 'Show detailed AR aging by customer' },
                    { text: 'Past Due AR', question: 'Which invoices are past due?' },
                    { text: 'Top AR Balances', question: 'Who are our top AR customers?' },
                    { text: 'Days Sales Outstanding', question: "What's our DSO?" },
                    { text: 'Customer Payments', question: 'Show recent customer payments' },
                    { text: 'Days to Pay', question: 'Show average days to pay by customer' }
                ]
            },
            ap: {
                name: 'Accounts Payable',
                icon: 'fa-file-invoice',
                color: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
                queries: [
                    { text: 'AP Aging', question: 'Show AP aging summary' },
                    { text: 'Bills Due', question: 'What bills are due this week?' },
                    { text: 'Past Due Bills', question: 'Which bills are past due?' },
                    { text: 'Top Vendors', question: 'Who are our top vendors by spend?' },
                    { text: 'Days Payable', question: "What's our DPO?" },
                    { text: 'Vendor Spend YoY', question: 'Show vendor spend comparison year over year' }
                ]
            },
            revenue: {
                name: 'Revenue & Sales',
                icon: 'fa-chart-line',
                color: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
                queries: [
                    { text: 'Top Customers', question: 'Who are our top 10 customers this year?' },
                    { text: 'Revenue by Dept', question: 'Show revenue by department YTD' },
                    { text: 'Monthly Trend', question: 'Show monthly revenue trend' },
                    { text: 'YTD by Customer', question: 'Show YTD revenue by customer' },
                    { text: 'Weekly Revenue', question: 'What was revenue last week?' },
                    { text: 'Customer for Dept', question: 'Top customers for ', prefill: true, placeholder: 'Enter department' }
                ]
            },
            profitability: {
                name: 'Profitability',
                icon: 'fa-balance-scale',
                color: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)',
                queries: [
                    { text: 'Net Profit YTD', question: 'What is our net profit year to date?' },
                    { text: 'Gross Margin', question: "What's our gross margin?" },
                    { text: 'Margin by Dept', question: 'Show gross margin by department' },
                    { text: 'Department Margins', question: 'Which departments have the best margins?' }
                ]
            },
            expenses: {
                name: 'Expenses',
                icon: 'fa-receipt',
                color: 'linear-gradient(135deg, #f97316 0%, #ea580c 100%)',
                queries: [
                    { text: 'Expense Breakdown', question: 'Break down expenses by category YTD' },
                    { text: 'Expenses by Dept', question: 'Show expenses by department' },
                    { text: 'Monthly Expenses', question: 'Show monthly expense trend' },
                    { text: 'Top Expense Accounts', question: 'What are our largest expense accounts?' }
                ]
            },
            orders: {
                name: 'Orders & Pipeline',
                icon: 'fa-shopping-cart',
                color: 'linear-gradient(135deg, #ec4899 0%, #db2777 100%)',
                queries: [
                    { text: 'Open Sales Orders', question: 'Show open sales orders' },
                    { text: 'SO Backlog', question: 'What is our sales order backlog?' },
                    { text: 'Recent Orders', question: 'Show orders placed this week' },
                    { text: 'Open POs', question: 'Show open purchase orders' }
                ]
            },
            gl: {
                name: 'General Ledger',
                icon: 'fa-book',
                color: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
                queries: [
                    { text: 'Account Activity', question: 'Show GL activity for ', prefill: true, placeholder: 'Enter account name' },
                    { text: 'Journal Entries', question: 'Show recent journal entries' },
                    { text: 'Transaction Detail', question: 'Show GL detail for transaction #', prefill: true, placeholder: 'Enter transaction ID' }
                ]
            },
            labor: {
                name: 'Labor & Time',
                icon: 'fa-user-clock',
                color: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                queries: [
                    { text: 'Hours by Employee', question: 'Show hours by employee this month' },
                    { text: 'Billable Hours', question: 'Show billable hours by employee' },
                    { text: 'Utilization Rate', question: 'Show utilization rate by employee' }
                ]
            },
            inventory: {
                name: 'Inventory',
                icon: 'fa-boxes',
                color: 'linear-gradient(135deg, #84cc16 0%, #65a30d 100%)',
                queries: [
                    { text: 'Stock Levels', question: 'Show current inventory levels' },
                    { text: 'Low Stock', question: 'What items are below reorder point?' },
                    { text: 'Inventory Value', question: 'What is total inventory value?' },
                    { text: 'Stock Movement', question: 'Show inventory movement this month' }
                ]
            },
            transactions: {
                name: 'Find Transaction',
                icon: 'fa-search',
                color: 'linear-gradient(135deg, #64748b 0%, #475569 100%)',
                queries: [
                    { text: 'Find Invoice', question: 'Find invoice #', prefill: true, placeholder: 'Enter invoice number' },
                    { text: 'Find Bill', question: 'Find vendor bill #', prefill: true, placeholder: 'Enter bill number' },
                    { text: 'Find SO', question: 'Find sales order #', prefill: true, placeholder: 'Enter SO number' },
                    { text: 'Find PO', question: 'Find purchase order #', prefill: true, placeholder: 'Enter PO number' },
                    { text: "Today's Invoices", question: 'Show invoices created today' },
                    { text: 'Customer Invoices', question: 'Show invoices for ', prefill: true, placeholder: 'Enter customer name' },
                    { text: 'Latest Invoice', question: 'Show the latest invoice' },
                    { text: 'Latest Bill', question: 'Show the latest vendor bill' }
                ]
            }
        },
        
        /**
         * Show queries for a category
         */
        showCategoryQueries: function(categoryId) {
            const category = this.queryCategories[categoryId];
            if (!category) return;
            
            const categoriesEl = document.getElementById('query-categories');
            const panelEl = document.getElementById('query-panel');
            const iconEl = document.getElementById('query-panel-icon');
            const titleEl = document.getElementById('query-panel-title');
            const gridEl = document.getElementById('query-panel-grid');
            
            if (!categoriesEl || !panelEl) return;
            
            // Update panel header
            iconEl.style.background = category.color;
            iconEl.innerHTML = `<i class="fas ${category.icon}"></i>`;
            titleEl.textContent = category.name;
            
            // Build query buttons
            gridEl.innerHTML = category.queries.map(q => {
                const prefillAttr = q.prefill ? 'data-prefill="true"' : '';
                const icon = q.prefill ? 'fa-pen' : 'fa-arrow-right';
                return `
                    <button class="query-panel-item ${q.prefill ? 'prefill-mode' : ''}" 
                            data-question="${this.escapeHtml(q.question)}" 
                            ${prefillAttr}>
                        <span>${this.escapeHtml(q.text)}</span>
                        <i class="fas ${icon}"></i>
                    </button>
                `;
            }).join('');
            
            // Bind click handlers
            const self = this;
            const input = document.getElementById('advisor-input-full');
            gridEl.querySelectorAll('.query-panel-item').forEach(item => {
                item.addEventListener('click', () => {
                    const question = item.getAttribute('data-question');
                    const isPrefill = item.getAttribute('data-prefill') === 'true';
                    
                    if (question && input) {
                        input.value = question;
                        
                        if (isPrefill) {
                            // Just prefill and focus - don't send
                            self.hideCategoryQueries();
                            input.focus();
                            // Position cursor at end
                            input.setSelectionRange(input.value.length, input.value.length);
                        } else {
                            // Auto-send
                            self.sendMessage().then(() => {
                                input.value = '';
                                input.style.height = 'auto';
                            });
                        }
                    }
                });
            });
            
            // Show panel, hide categories
            categoriesEl.style.display = 'none';
            panelEl.style.display = 'block';
        },
        
        /**
         * Hide category queries, show categories
         */
        hideCategoryQueries: function() {
            const categoriesEl = document.getElementById('query-categories');
            const panelEl = document.getElementById('query-panel');
            
            if (categoriesEl) categoriesEl.style.display = 'grid';
            if (panelEl) panelEl.style.display = 'none';
        },
        
        /**
         * Send a message to the advisor
         */
        sendMessage: async function() {
            const input = document.getElementById('advisor-input-full');
            const text = input ? input.value.trim() : '';
            
            if (!text || isProcessing) return;
            
            // Store for retry functionality
            this.lastUserMessage = text;
            
            // Clear input and follow-up suggestions
            input.value = '';
            input.style.height = 'auto';
            this.clearFollowUpSuggestions();
            
            // Hide welcome
            const welcome = document.getElementById('advisor-welcome-full');
            if (welcome) welcome.style.display = 'none';
            
            // Add user message
            this.addMessage('user', text);
            
            // Show thinking state
            const thinkingId = this.showThinking();
            isProcessing = true;
            this.updateSendButton(true);
            
            try {
                // Build history for API
                const history = messages
                    .filter(m => m.role !== 'thinking')
                    .slice(-MAX_HISTORY)
                    .map(m => ({ role: m.role, content: m.content }));
                
                // Get AI mode settings
                const settings = this.getSettings();
                const aiSettings = {
                    mode: settings.aiMode || 'smart',
                    customProvider: settings.customProvider || 'gemini',
                    tier1Model: settings.tier1Model,
                    tier2Model: settings.tier2Model,
                    tier3Model: settings.tier3Model
                };
                
                // Call API
                const response = await API.post('advisor_chat', {
                    message: text,
                    history: history,
                    context: { dashboard: 'advisor' },
                    aiSettings: aiSettings,
                    sessionContext: sessionContext  // Send resolved entities back to avoid re-resolution
                });
                
                // Remove thinking
                this.hideThinking(thinkingId);
                
                // Add response with progressive reveal
                this.addAssistantMessage(response);
                
            } catch (err) {
                console.error('[Advisor] Error:', err);
                this.hideThinking(thinkingId);
                this.addMessage('assistant', 'I encountered an error. Please try again.', null, [{
                    type: 'error',
                    title: 'Error',
                    content: err.message,
                    status: 'error'
                }]);
            } finally {
                isProcessing = false;
                this.updateSendButton(false);
            }
        },
        
        /**
         * Update send button state
         */
        updateSendButton: function(disabled) {
            const btn = document.getElementById('advisor-send-full');
            if (btn) {
                btn.disabled = disabled;
            }
        },
        
        /**
         * Retry the last query or a specific query
         */
        retryQuery: function(query) {
            const input = document.getElementById('advisor-input-full');
            if (!input) return;
            
            // Use provided query or fall back to lastUserMessage
            const queryToRetry = query || this.lastUserMessage;
            if (!queryToRetry) {
                console.warn('[Advisor] No query to retry');
                return;
            }
            
            // Set the input value and trigger send
            input.value = queryToRetry;
            this.sendMessage();
        },
        
        /**
         * Show thinking indicator
         */
        showThinking: function() {
            const container = document.getElementById('advisor-messages-full');
            if (!container) return null;
            
            // Use a consistent ID so we can find it later
            const id = 'advisor-thinking';
            
            // Remove any existing thinking indicator first
            const existing = document.getElementById(id);
            if (existing) existing.remove();
            
            const div = document.createElement('div');
            div.id = id;
            div.className = 'advisor-message assistant';
            div.innerHTML = `
                <div class="message-bubble">
                    <div class="thinking-indicator">
                        <div class="thinking-dot"></div>
                        <div class="thinking-dot"></div>
                        <div class="thinking-dot"></div>
                    </div>
                </div>
            `;
            container.appendChild(div);
            this.scrollToBottom();
            return id;
        },
        
        /**
         * Hide thinking indicator
         */
        hideThinking: function(id) {
            // Always try to remove the standard thinking element
            const el = document.getElementById(id || 'advisor-thinking');
            if (el) el.remove();
        },
        
        /**
         * Add a message to the chat
         */
        addMessage: function(role, content, richContent, steps) {
            const msg = {
                role: role,
                content: content,
                richContent: richContent || null,
                steps: steps || null,
                timestamp: Date.now()
            };
            messages.push(msg);
            this.renderMessage(msg);
            this.saveSession();
            this.scrollToBottom();
        },
        
        /**
         * Add assistant message with metadata
         */
        addAssistantMessage: function(response) {
            const msg = {
                role: 'assistant',
                content: response.text || '',
                richContent: response.richContent || null,
                steps: response.steps || null,
                model: response.model,
                provider: response.provider,
                duration: response.duration,
                userQuery: this.lastUserMessage || '',  // Store the user query for retry
                timestamp: Date.now()
            };
            messages.push(msg);
            this.renderMessageProgressive(msg);
            this.saveSession();
            
            // Merge session context from this response
            // This persists entity resolutions, order, topics, and history across messages
            if (response.sessionContext) {
                // Merge resolvedEntities (additive)
                if (response.sessionContext.resolvedEntities) {
                    sessionContext.resolvedEntities = sessionContext.resolvedEntities || {};
                    Object.assign(sessionContext.resolvedEntities, response.sessionContext.resolvedEntities);
                }
                
                // CRITICAL: Replace entityOrder with server's version (it tracks recency correctly)
                if (response.sessionContext.entityOrder && Array.isArray(response.sessionContext.entityOrder)) {
                    sessionContext.entityOrder = response.sessionContext.entityOrder;
                }
                
                // Merge topics (additive, keep unique)
                if (response.sessionContext.topics && Array.isArray(response.sessionContext.topics)) {
                    sessionContext.topics = sessionContext.topics || [];
                    response.sessionContext.topics.forEach(function(topic) {
                        if (sessionContext.topics.indexOf(topic) === -1) {
                            sessionContext.topics.push(topic);
                        }
                    });
                    // Keep last 20 topics
                    if (sessionContext.topics.length > 20) {
                        sessionContext.topics = sessionContext.topics.slice(-20);
                    }
                }
                
                // Replace queryHistory with server's version
                if (response.sessionContext.queryHistory && Array.isArray(response.sessionContext.queryHistory)) {
                    sessionContext.queryHistory = response.sessionContext.queryHistory;
                }
            }
            
            // Render follow-up suggestions if provided
            const suggestions = response.followUpSuggestions || 
                               (response.sessionContext && response.sessionContext.followUpSuggestions);
            if (suggestions && suggestions.length > 0) {
                this.renderFollowUpSuggestions(suggestions);
            } else {
                this.clearFollowUpSuggestions();
            }
        },
        
        /**
         * Render follow-up suggestions below input
         */
        renderFollowUpSuggestions: function(suggestions) {
            const container = document.getElementById('followUpSuggestions');
            if (!container) return;
            
            // Take max 3 suggestions
            const chips = suggestions.slice(0, 3);
            
            // Add title attribute for tooltip showing full text on hover
            container.innerHTML = chips.map(suggestion => 
                `<button class="follow-up-chip" data-suggestion="${this.escapeHtml(suggestion)}" title="${this.escapeHtml(suggestion)}">${this.escapeHtml(suggestion)}</button>`
            ).join('');
            
            // Bind click handlers
            container.querySelectorAll('.follow-up-chip').forEach(chip => {
                chip.addEventListener('click', () => {
                    const text = chip.dataset.suggestion;
                    if (text) {
                        const input = document.getElementById('advisor-input-full');
                        if (input) {
                            input.value = text;
                            this.sendMessage();
                        }
                    }
                });
            });
        },
        
        /**
         * Clear follow-up suggestions
         */
        clearFollowUpSuggestions: function() {
            const container = document.getElementById('followUpSuggestions');
            if (container) {
                container.innerHTML = '';
            }
        },
        
        /**
         * Render assistant message content (blocks format only)
         * Shared by both progressive and static rendering
         */
        renderAssistantContent: function(msg, bubble) {
            // Render steps
            if (msg.steps && msg.steps.length > 0) {
                const stepsContainer = document.createElement('div');
                stepsContainer.className = 'message-steps';
                stepsContainer.innerHTML = this.renderSteps(msg.steps);
                bubble.appendChild(stepsContainer);
            }
            
            // Render rich content blocks in natural order
            if (msg.richContent && msg.richContent.length > 0) {
                msg.richContent.forEach(item => {
                    const div = document.createElement('div');
                    div.className = item.type === 'text' ? 'message-text' : 'message-rich';
                    div.innerHTML = this.renderRichContent(item);
                    bubble.appendChild(div);
                });
            }
            
            // Render any legacy text content (fallback)
            if (msg.content && msg.content.trim() && (!msg.richContent || msg.richContent.length === 0)) {
                const textDiv = document.createElement('div');
                textDiv.className = 'message-text';
                textDiv.innerHTML = this.formatText(msg.content);
                bubble.appendChild(textDiv);
            }
            
            // Add message footer with model badge and response actions
            if (msg.model) {
                const msgId = 'msg-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5);
                const retryQuery = msg.userQuery ? this.escapeHtml(msg.userQuery).replace(/'/g, "\\'") : '';
                const footer = document.createElement('div');
                footer.className = 'message-footer';
                footer.id = msgId;
                footer.innerHTML = `
                    <div class="model-badge">${this.escapeHtml(msg.model)}</div>
                    <div class="response-actions">
                        <button class="action-btn action-btn-subtle" onclick="AdvisorChat.retryQuery('${retryQuery}')" title="Retry">
                            <i class="fas fa-redo"></i>
                        </button>
                        <button class="action-btn" onclick="AdvisorChat.copyResponse('${msgId}')" title="Copy">
                            <i class="fas fa-copy"></i>
                        </button>
                        <button class="action-btn" onclick="AdvisorChat.printResponse('${msgId}')" title="Print">
                            <i class="fas fa-print"></i>
                        </button>
                    </div>
                `;
                bubble.appendChild(footer);
            }
        },
        
        /**
         * Progressively render message with steps
         */
        renderMessageProgressive: async function(msg) {
            const container = document.getElementById('advisor-messages-full');
            if (!container) return;
            
            const div = document.createElement('div');
            div.className = 'advisor-message assistant';
            
            const bubble = document.createElement('div');
            bubble.className = 'message-bubble';
            div.appendChild(bubble);
            container.appendChild(div);
            
            this.renderAssistantContent(msg, bubble);
            this.scrollToBottom();
        },
        
        /**
         * Delay helper
         */
        delay: function(ms) {
            return new Promise(resolve => setTimeout(resolve, ms));
        },
        
        /**
         * Render a single message (used for session restore)
         */
        renderMessage: function(msg) {
            const container = document.getElementById('advisor-messages-full');
            if (!container) return;
            
            const div = document.createElement('div');
            div.className = `advisor-message ${msg.role}`;
            
            if (msg.role === 'user') {
                const initial = this.getUserInitial();
                div.innerHTML = `<div class="message-bubble"><div class="user-bubble-inner" data-initial="${initial}"><div class="message-text">${this.escapeHtml(msg.content)}</div></div></div>`;
            } else {
                const bubble = document.createElement('div');
                bubble.className = 'message-bubble';
                div.appendChild(bubble);
                this.renderAssistantContent(msg, bubble);
            }
            
            container.appendChild(div);
        },
        
        /**
         * Get user initial for avatar
         */
        getUserInitial: function() {
            // Try to get from NetSuite user context or default to 'U'
            if (typeof window !== 'undefined' && window.gantryUser && window.gantryUser.name) {
                return window.gantryUser.name.charAt(0).toUpperCase();
            }
            return 'U';
        },
        
        /**
         * Render steps as compact expandable pills
         */
        renderSteps: function(steps) {
            if (!steps || steps.length === 0) return '';
            
            let html = '<div class="message-steps">';
            steps.forEach((step, idx) => {
                html += this.renderStep(step, idx);
            });
            html += '</div>';
            
            return html;
        },
        
        /**
         * Render a single step as compact expandable pill
         */
        renderStep: function(step, idx) {
            const statusClass = step.status || 'complete';
            const icon = this.getStepIcon(step);
            const title = step.title || step.type || 'Processing';
            const shortTitle = title.length > 40 ? title.substring(0, 40) + '...' : title;
            
            // Never auto-expand steps - user requested collapsed by default
            const shouldAutoOpen = false;
            
            // Build detail content
            let detailContent = '';
            
            // Special handling for planning steps - show rich details
            if (step.type === 'planning' && step.plan) {
                const plan = step.plan;
                
                // Show complexity badge
                if (plan.complexity) {
                    const complexityClass = plan.complexity === 'simple' ? 'success' : 
                                           plan.complexity === 'multi_step' ? 'warning' : 'info';
                    detailContent += `<div class="plan-complexity"><span class="complexity-badge ${complexityClass}">${this.escapeHtml(plan.complexity)}</span></div>`;
                }
                
                // Show reasoning
                if (plan.reasoning) {
                    detailContent += `<div class="plan-reasoning"><strong>Reasoning:</strong> ${this.escapeHtml(plan.reasoning)}</div>`;
                }
                
                // Show template match if present
                if (plan.template_match) {
                    detailContent += `<div class="plan-template"><i class="fas fa-puzzle-piece"></i> Template: <code>${this.escapeHtml(plan.template_match)}</code></div>`;
                }
                
                // Show entities to resolve
                if (plan.entities_to_resolve && plan.entities_to_resolve.length > 0) {
                    const entityList = plan.entities_to_resolve.map(e => 
                        `<span class="entity-chip">${this.escapeHtml(e.term)} <small>(${e.entity_type})</small></span>`
                    ).join(' ');
                    detailContent += `<div class="plan-entities"><i class="fas fa-search"></i> Entities: ${entityList}</div>`;
                }
                
                // Show plan steps
                if (plan.plan && plan.plan.length > 0) {
                    detailContent += '<div class="plan-steps"><strong>Plan:</strong><ol class="plan-step-list">';
                    plan.plan.forEach(s => {
                        const actionIcon = s.action === 'query' ? 'fa-database' : 
                                          s.action === 'template' ? 'fa-puzzle-piece' :
                                          s.action === 'resolve_entity' ? 'fa-search' : 'fa-cog';
                        detailContent += `<li><i class="fas ${actionIcon}"></i> ${this.escapeHtml(s.purpose || s.action)}</li>`;
                    });
                    detailContent += '</ol></div>';
                }
                
                // Show if synthesis required
                if (plan.requires_synthesis === true) {
                    detailContent += `<div class="plan-synthesis"><i class="fas fa-brain"></i> Requires synthesis</div>`;
                }
            }
            
            // Special handling for template steps - show template details
            if (step.type === 'template') {
                // Show template ID
                if (step.templateId) {
                    detailContent += `<div class="template-id"><i class="fas fa-puzzle-piece"></i> Template: <code>${this.escapeHtml(step.templateId)}</code></div>`;
                }
                
                // Show category badge if present
                if (step.templateCategory) {
                    const categoryClass = {
                        'AR': 'warning',
                        'AP': 'danger', 
                        'CASH': 'success',
                        'REVENUE': 'info',
                        'EXPENSE': 'danger',
                        'TRANSACTIONS': 'secondary'
                    }[step.templateCategory] || 'info';
                    detailContent += `<div class="template-category"><span class="category-badge ${categoryClass}">${this.escapeHtml(step.templateCategory)}</span></div>`;
                }
                
                // Show description/content if present
                if (step.content) {
                    detailContent += `<div class="template-description"><i class="fas fa-info-circle"></i> ${this.escapeHtml(step.content)}</div>`;
                }
            }
            
            // Special handling for agent_step and tool types - show rich execution details
            if (step.type === 'agent_step' || step.type === 'tool') {
                // Show tool badge
                if (step.toolName) {
                    const toolIcons = {
                        'execute_query': 'fa-database',
                        'execute_template': 'fa-puzzle-piece',
                        'resolve_entity': 'fa-search',
                        'get_dashboard_data': 'fa-chart-bar',
                        'calculate': 'fa-calculator'
                    };
                    const toolIcon = toolIcons[step.toolName] || 'fa-cog';
                    const toolLabel = step.toolName.replace(/_/g, ' ');
                    detailContent += `<div class="step-tool-badge"><i class="fas ${toolIcon}"></i> ${this.escapeHtml(toolLabel)}</div>`;
                }
                
                // Show template parameters if present
                if (step.toolArgs && step.toolArgs.template_id) {
                    detailContent += `<div class="step-template-id"><i class="fas fa-puzzle-piece"></i> Template: <code>${this.escapeHtml(step.toolArgs.template_id)}</code></div>`;
                    
                    // Show parameters
                    if (step.toolArgs.parameters && Object.keys(step.toolArgs.parameters).length > 0) {
                        const paramChips = Object.entries(step.toolArgs.parameters)
                            .filter(([k, v]) => v !== null && v !== undefined)
                            .map(([k, v]) => `<span class="param-chip"><strong>${this.escapeHtml(k)}:</strong> ${this.escapeHtml(String(v))}</span>`)
                            .join('');
                        if (paramChips) {
                            detailContent += `<div class="step-params"><i class="fas fa-sliders-h"></i> ${paramChips}</div>`;
                        }
                    }
                }
                
                // Show substitutions (what was actually replaced in the query)
                if (step.substitutions && Object.keys(step.substitutions).length > 0) {
                    const subList = Object.entries(step.substitutions)
                        .map(([k, v]) => `<span class="sub-item"><code>${this.escapeHtml(k)}</code> → <em>${this.escapeHtml(String(v))}</em></span>`)
                        .join('');
                    detailContent += `<div class="step-substitutions"><i class="fas fa-exchange-alt"></i> Substitutions: ${subList}</div>`;
                }
                
                // Show columns returned
                if (step.columns && step.columns.length > 0) {
                    const columnChips = step.columns.map(c => `<span class="column-chip">${this.escapeHtml(c)}</span>`).join('');
                    detailContent += `<div class="step-columns"><i class="fas fa-columns"></i> ${columnChips}</div>`;
                }
                
                // Show sample data preview (compact table)
                if (step.sampleData && step.sampleData.length > 0 && step.columns) {
                    const previewRows = step.sampleData.slice(0, 3); // Max 3 rows
                    detailContent += '<div class="step-sample-data">';
                    detailContent += '<div class="sample-data-header"><i class="fas fa-eye"></i> Preview</div>';
                    detailContent += '<table class="sample-data-table"><thead><tr>';
                    step.columns.forEach(col => {
                        detailContent += `<th>${this.escapeHtml(col)}</th>`;
                    });
                    detailContent += '</tr></thead><tbody>';
                    previewRows.forEach(row => {
                        detailContent += '<tr>';
                        step.columns.forEach(col => {
                            let val = row[col];
                            // Format numbers
                            if (typeof val === 'number') {
                                if (col.toLowerCase().includes('amount') || col.toLowerCase().includes('total') || col.toLowerCase().includes('spend')) {
                                    val = this.formatCurrency(val);
                                } else {
                                    val = val.toLocaleString();
                                }
                            }
                            detailContent += `<td>${this.escapeHtml(String(val ?? ''))}</td>`;
                        });
                        detailContent += '</tr>';
                    });
                    detailContent += '</tbody></table>';
                    if (step.sampleData.length > 3) {
                        detailContent += `<div class="sample-data-more">+${step.sampleData.length - 3} more rows</div>`;
                    }
                    detailContent += '</div>';
                }
                
                // Show retry guidance if present
                if (step.retryGuidance) {
                    detailContent += `<div class="step-retry-guidance"><i class="fas fa-lightbulb"></i> ${this.escapeHtml(step.retryGuidance)}</div>`;
                }
                
                // Fallback for agent_step without detailed info
                if (!step.toolName && !step.sql && !step.sampleData) {
                    if (step.title && step.title.includes('Processing') || step.title && step.title.includes('Waiting')) {
                        detailContent += '<div class="step-info-fallback">';
                        detailContent += '<div class="fallback-item"><i class="fas fa-sync-alt"></i> Agent is processing results</div>';
                        if (step.content && step.content !== 'Processing...') {
                            detailContent += `<div class="fallback-item"><i class="fas fa-info-circle"></i> ${this.escapeHtml(step.content)}</div>`;
                        }
                        detailContent += '</div>';
                    } else if (step.content) {
                        detailContent += `<div class="step-content-detail"><i class="fas fa-info-circle"></i> ${this.escapeHtml(step.content)}</div>`;
                    }
                }
            }
            
            // Render deep_thinking step details
            if (step.type === 'deep_thinking' && step.deepThink) {
                const dt = step.deepThink;
                detailContent += '<div class="deep-think-details">';
                
                // Thinking type badge
                detailContent += `<div class="deep-think-type"><span class="thinking-type-badge">${this.escapeHtml(dt.type || 'analysis')}</span></div>`;
                
                // Reasoning steps
                if (dt.steps && dt.steps.length > 0) {
                    detailContent += '<div class="deep-think-reasoning"><div class="reasoning-label">Reasoning:</div><ol class="reasoning-steps">';
                    dt.steps.forEach(step => {
                        detailContent += `<li>${this.escapeHtml(step)}</li>`;
                    });
                    detailContent += '</ol></div>';
                }
                
                // Hypotheses
                if (dt.hypotheses && dt.hypotheses.length > 0) {
                    detailContent += '<div class="deep-think-hypotheses"><div class="section-label">Hypotheses:</div>';
                    dt.hypotheses.forEach(h => {
                        const actionIcon = h.action === 'support' ? '✅' : h.action === 'refute' ? '❌' : h.action === 'partial' ? '⚠️' : '💡';
                        detailContent += `<div class="hypothesis-item">${actionIcon} ${this.escapeHtml(h.text)}</div>`;
                    });
                    detailContent += '</div>';
                }
                
                // Findings
                if (dt.findings && dt.findings.length > 0) {
                    detailContent += '<div class="deep-think-findings"><div class="section-label">Findings:</div>';
                    dt.findings.forEach(f => {
                        const importanceClass = f.importance === 'high' ? 'high' : f.importance === 'low' ? 'low' : 'medium';
                        detailContent += `<div class="finding-item finding-${importanceClass}"><i class="fas fa-check-circle"></i> ${this.escapeHtml(f.insight)}</div>`;
                    });
                    detailContent += '</div>';
                }
                
                // Confidence
                if (dt.confidence && dt.confidence.overall !== undefined) {
                    const confidencePercent = Math.round(dt.confidence.overall * 100);
                    const confidenceClass = confidencePercent >= 70 ? 'high' : confidencePercent >= 40 ? 'medium' : 'low';
                    detailContent += `<div class="deep-think-confidence confidence-${confidenceClass}">
                        <i class="fas fa-chart-line"></i> Confidence: ${confidencePercent}%
                        ${dt.confidence.reasoning ? `<span class="confidence-reason">(${this.escapeHtml(dt.confidence.reasoning)})</span>` : ''}
                    </div>`;
                }
                
                detailContent += '</div>';
            }
            
            // Render reflection step details
            if (step.type === 'reflection' && step.reflection) {
                const ref = step.reflection;
                detailContent += '<div class="reflection-details">';
                
                // Assessment badge
                const assessmentColors = {
                    'on_track': 'success',
                    'needs_modification': 'warning', 
                    'needs_expansion': 'info',
                    'can_simplify': 'success',
                    'blocked': 'danger'
                };
                const assessmentColor = assessmentColors[ref.assessment] || 'info';
                detailContent += `<div class="reflection-assessment">
                    <span class="assessment-badge badge-${assessmentColor}">${this.escapeHtml(ref.assessment || 'analyzing')}</span>
                    <span class="confidence-badge">${Math.round((ref.confidence || 0.5) * 100)}% confident</span>
                </div>`;
                
                // Key findings
                if (ref.keyFindings && ref.keyFindings.length > 0) {
                    detailContent += '<div class="reflection-findings"><div class="section-label">Key Findings:</div><ul>';
                    ref.keyFindings.forEach(f => {
                        detailContent += `<li>${this.escapeHtml(f)}</li>`;
                    });
                    detailContent += '</ul></div>';
                }
                
                detailContent += '</div>';
            }
            
            // Render plan_adaptation step details
            if (step.type === 'plan_adaptation' && step.modifications) {
                detailContent += '<div class="plan-adaptation-details">';
                detailContent += '<div class="section-label">Plan Modifications:</div><ul class="modifications-list">';
                step.modifications.forEach(mod => {
                    const actionIcon = mod.action === 'add_query' ? '➕' : mod.action === 'skip_step' ? '⏭️' : mod.action === 'modify_step' ? '✏️' : '🔄';
                    detailContent += `<li><span class="mod-action">${actionIcon} ${this.escapeHtml(mod.action)}</span>: ${this.escapeHtml(mod.reason)}</li>`;
                });
                detailContent += '</ul></div>';
            }
            
            // Render dashboard step details
            if (step.type === 'dashboard') {
                detailContent += '<div class="dashboard-step-details">';
                
                // Show dashboard ID badge
                if (step.dashboardId) {
                    const dashboardNames = {
                        'cashflow': 'Liquidity',
                        'health': 'P&L',
                        'burden': 'True Cost',
                        'time': 'Billable IQ',
                        'integrity': 'Sentinel',
                        'vendorperformance': 'Procurement',
                        'customervalue': 'Revenue Intelligence',
                        'spendvelocity': 'Spend Velocity'
                    };
                    const displayName = dashboardNames[step.dashboardId] || step.dashboardId;
                    detailContent += `<div class="dashboard-badge"><i class="fas fa-chart-pie"></i> ${this.escapeHtml(displayName)}</div>`;
                }
                
                // Show cache status
                if (step.cached !== undefined) {
                    const cacheIcon = step.cached ? 'fa-bolt' : 'fa-cloud-download-alt';
                    const cacheText = step.cached ? 'Cached data' : 'Fresh data fetched';
                    detailContent += `<div class="cache-status"><i class="fas ${cacheIcon}"></i> ${cacheText}</div>`;
                }
                
                // Show data size
                if (step.dataSize) {
                    const sizeKB = (step.dataSize / 1024).toFixed(1);
                    detailContent += `<div class="data-size"><i class="fas fa-database"></i> ${sizeKB} KB loaded</div>`;
                }
                
                // Show metrics items if present
                if (step.metrics && step.metrics.length > 0) {
                    detailContent += '<div class="dashboard-metrics">';
                    step.metrics.forEach(item => {
                        detailContent += `<span class="metric-chip">${this.escapeHtml(item)}</span>`;
                    });
                    detailContent += '</div>';
                }
                
                detailContent += '</div>';
            }
            
            // Render analyzing step details  
            if (step.type === 'analyzing') {
                detailContent += '<div class="analyzing-step-details">';
                
                // Show what's being analyzed
                if (step.dashboardId) {
                    detailContent += `<div class="analyzing-source"><i class="fas fa-chart-pie"></i> Analyzing ${this.escapeHtml(step.dashboardId)} dashboard</div>`;
                }
                
                // Show data point count
                if (step.dataPointCount !== undefined) {
                    detailContent += `<div class="data-point-count"><i class="fas fa-list-ol"></i> ${step.dataPointCount} data points</div>`;
                }
                
                // Show section count
                if (step.sectionCount !== undefined) {
                    detailContent += `<div class="section-count"><i class="fas fa-layer-group"></i> ${step.sectionCount} data sections</div>`;
                }
                
                // If no specific info available, extract from title or show generic message
                if (!step.dashboardId && step.dataPointCount === undefined && step.sectionCount === undefined) {
                    // Try to extract row count from title like "Analyzing 1 rows"
                    const rowMatch = step.title && step.title.match(/(\d+)\s*rows?/i);
                    if (rowMatch) {
                        const rowCount = parseInt(rowMatch[1], 10);
                        detailContent += `<div class="analyzing-info"><i class="fas fa-table"></i> Processing ${rowCount} ${rowCount === 1 ? 'row' : 'rows'} of data</div>`;
                        if (rowCount === 1) {
                            detailContent += `<div class="analyzing-info"><i class="fas fa-check-circle"></i> Single result - formatting for display</div>`;
                        } else if (rowCount <= 10) {
                            detailContent += `<div class="analyzing-info"><i class="fas fa-list"></i> Small dataset - showing all results</div>`;
                        } else {
                            detailContent += `<div class="analyzing-info"><i class="fas fa-filter"></i> Analyzing patterns and preparing summary</div>`;
                        }
                    } else {
                        detailContent += `<div class="analyzing-info"><i class="fas fa-cog"></i> Processing query results</div>`;
                    }
                }
                
                detailContent += '</div>';
            }
            
            // Render text_response_warning step details (when LLM returns text instead of tool calls)
            if (step.type === 'text_response_warning') {
                detailContent += '<div class="text-response-warning-details">';
                
                // Show progress indicator
                if (step.completedQueries !== undefined && step.totalQueries !== undefined) {
                    const progress = step.totalQueries > 0 ? Math.round((step.completedQueries / step.totalQueries) * 100) : 0;
                    detailContent += `<div class="query-progress">
                        <div class="progress-bar">
                            <div class="progress-fill" style="width: ${progress}%"></div>
                        </div>
                        <span class="progress-text">${step.completedQueries}/${step.totalQueries} queries completed</span>
                    </div>`;
                }
                
                // Show failure count
                if (step.consecutiveFailures) {
                    const severity = step.consecutiveFailures >= 3 ? 'high' : step.consecutiveFailures >= 2 ? 'medium' : 'low';
                    detailContent += `<div class="failure-count severity-${severity}">
                        <i class="fas fa-exclamation-triangle"></i> 
                        ${step.consecutiveFailures} consecutive text response${step.consecutiveFailures > 1 ? 's' : ''} (model not using tools)
                    </div>`;
                }
                
                // Show what the LLM returned
                if (step.llmResponse) {
                    detailContent += `<div class="llm-response-preview">
                        <div class="preview-label"><i class="fas fa-comment"></i> LLM response (instead of tool call):</div>
                        <pre class="llm-text-preview">${this.escapeHtml(step.llmResponse)}</pre>
                    </div>`;
                }
                
                detailContent += '</div>';
            }
            
            // Add content/message
            if (step.content) {
                detailContent += `<div class="tool-call-content">${this.escapeHtml(step.content)}</div>`;
            }
            
            // Add SQL with syntax highlighting and copy button
            if (step.sql) {
                const sqlId = 'sql-' + idx + '-' + Math.random().toString(36).substr(2, 5);
                const highlighted = this.highlightSQL(step.sql);
                detailContent += `
                    <div class="tool-call-sql">
                        <div class="sql-header">
                            <span>SuiteQL</span>
                            <button class="sql-copy-btn" onclick="event.stopPropagation(); AdvisorChat.copySQL('${sqlId}')" title="Copy SQL">
                                <i class="fas fa-copy"></i>
                            </button>
                        </div>
                        <pre class="sql-code" id="${sqlId}">${highlighted}</pre>
                    </div>
                `;
            }
            
            // Add row count if present
            if (step.rowCount !== undefined) {
                detailContent += `<div class="tool-call-meta"><i class="fas fa-table"></i> ${step.rowCount} row${step.rowCount !== 1 ? 's' : ''} returned</div>`;
            }
            
            // Add error details
            if (step.error) {
                detailContent += `<div class="tool-call-error"><i class="fas fa-exclamation-circle"></i> ${this.escapeHtml(step.error)}</div>`;
            }
            
            // Add LLM calls if present
            if (step.type === 'llm_calls' && step.calls) {
                detailContent += '<div class="llm-calls-list">';
                step.calls.forEach(call => {
                    const duration = call.duration ? (call.duration / 1000).toFixed(1) + 's' : '';
                    const callStatus = call.error ? 'error' : '';
                    const typeIcon = call.type === 'tool_call' ? 'fa-wrench' : 
                                    call.type === 'text' ? 'fa-comment' : 'fa-question';
                    const tierBadge = call.tier ? `<span class="llm-tier-badge tier-${call.tier}">T${call.tier}</span>` : '';
                    detailContent += `
                        <div class="llm-call-item ${callStatus}">
                            <i class="fas ${typeIcon} llm-type-icon"></i>
                            <span class="llm-call-purpose">${this.escapeHtml(call.purpose || 'AI call')}</span>
                            ${tierBadge}
                            <span class="llm-call-model">${this.escapeHtml(call.model || '')}</span>
                            <span class="llm-call-duration">${duration}</span>
                            ${call.error ? `<span class="llm-call-error-badge">Error</span>` : ''}
                        </div>
                    `;
                });
                detailContent += '</div>';
            }
            
            return `
                <details class="tool-call ${statusClass}" ${shouldAutoOpen ? 'open' : ''}>
                    <summary class="tool-call-header">
                        <span class="tool-call-icon">${icon}</span>
                        <span class="tool-call-title">${this.escapeHtml(shortTitle)}</span>
                        <span class="tool-call-status status-${statusClass}">${statusClass}</span>
                    </summary>
                    <div class="tool-call-body">
                        ${detailContent || '<div class="tool-call-content">No additional details</div>'}
                    </div>
                </details>
            `;
        },
        
        /**
         * Simple SQL syntax highlighting
         */
        highlightSQL: function(sql) {
            const escaped = this.escapeHtml(sql);
            // Highlight keywords
            const keywords = /\b(SELECT|FROM|WHERE|AND|OR|ORDER BY|GROUP BY|HAVING|JOIN|INNER|LEFT|RIGHT|OUTER|ON|AS|DISTINCT|COUNT|SUM|AVG|MIN|MAX|CASE|WHEN|THEN|ELSE|END|LIKE|IN|NOT|NULL|IS|BETWEEN|FETCH|FIRST|ROWS|ONLY|TO_DATE|TRUNC|CURRENT_DATE|BUILTIN\.DF|LIMIT|OFFSET|DESC|ASC|UNION|ALL)\b/gi;
            return escaped.replace(keywords, '<span class="keyword">$1</span>');
        },
        
        /**
         * Copy SQL to clipboard
         */
        copySQL: function(elementId) {
            const el = document.getElementById(elementId);
            if (!el) return;
            
            const text = el.textContent;
            navigator.clipboard.writeText(text).then(() => {
                // Show feedback
                const btn = el.parentElement.querySelector('.step-sql-copy');
                if (btn) {
                    const originalText = btn.innerHTML;
                    btn.innerHTML = '<i class="fas fa-check"></i> Copied';
                    btn.classList.add('copy-success');
                    setTimeout(() => {
                        btn.innerHTML = originalText;
                        btn.classList.remove('copy-success');
                    }, 2000);
                }
            });
        },

        /**
         * Get icon for step type
         */
        getStepIcon: function(step) {
            const icons = {
                'thinking': '<i class="fas fa-brain"></i>',
                'deep_thinking': '<i class="fas fa-brain"></i>',
                'reflection': '<i class="fas fa-sync-alt"></i>',
                'plan_adaptation': '<i class="fas fa-project-diagram"></i>',
                'classification': '<i class="fas fa-sitemap"></i>',
                'template': '<i class="fas fa-file-code"></i>',
                'ai': '<i class="fas fa-robot"></i>',
                'query': '<i class="fas fa-database"></i>',
                'dashboard': '<i class="fas fa-chart-pie"></i>',
                'analyzing': '<i class="fas fa-search"></i>',
                'retry': '<i class="fas fa-redo"></i>',
                'error': '<i class="fas fa-exclamation-triangle"></i>',
                'llm_calls': '<i class="fas fa-bolt"></i>',
                'planning': '<i class="fas fa-route"></i>',
                'agent_step': '<i class="fas fa-cogs"></i>',
                'tool': '<i class="fas fa-wrench"></i>',
                'resolving': '<i class="fas fa-search-plus"></i>',
                'entity_resolution': '<i class="fas fa-search-plus"></i>',
                'text_response_warning': '<i class="fas fa-comment-slash"></i>'
            };
            return icons[step.type] || '<i class="fas fa-cog"></i>';
        },
        
        /**
         * Render rich content (tables, metrics, etc.)
         */
        renderRichContent: function(item) {
            if (item.type === 'table') {
                // Use AdvisorRenderer for all table rendering (income statements, grouped, etc.)
                return AdvisorRenderer.renderTable(item);
            }
            if (item.type === 'metric') {
                return this.renderMetric(item);
            }
            if (item.type === 'metrics') {
                // Metrics block with multiple items
                return this.renderMetricsBlock(item);
            }
            if (item.type === 'chart') {
                return this.renderChart(item);
            }
            if (item.type === 'sparkline') {
                return this.renderSparkline(item);
            }
            if (item.type === 'transaction_card') {
                return this.renderTransactionCard(item);
            }
            if (item.type === 'text') {
                // Text block - render as markdown
                return `<div class="response-text-block">${this.formatText(item.content || '')}</div>`;
            }
            if (item.type === 'callout') {
                // Callout block with variant
                const variant = item.variant || 'info';
                const icons = {
                    'info': 'fa-info-circle',
                    'warning': 'fa-exclamation-triangle',
                    'success': 'fa-check-circle',
                    'error': 'fa-times-circle'
                };
                const icon = icons[variant] || icons.info;
                return `<div class="advisor-callout callout-${variant}"><i class="fas ${icon}"></i> <div class="callout-content">${this.formatText(item.content || '')}</div></div>`;
            }
            if (item.type === 'group') {
                // Group of nested blocks
                let html = '<div class="block-group">';
                if (item.blocks && Array.isArray(item.blocks)) {
                    item.blocks.forEach(block => {
                        html += this.renderRichContent(block);
                    });
                }
                html += '</div>';
                return html;
            }
            if (item.type === 'warning') {
                return `<div class="advisor-alert warning"><i class="fas fa-exclamation-triangle"></i> ${this.escapeHtml(item.message || item.text || item.content)}</div>`;
            }
            if (item.type === 'success') {
                return `<div class="advisor-alert success"><i class="fas fa-check-circle"></i> ${this.escapeHtml(item.message || item.text || item.content)}</div>`;
            }
            if (item.type === 'error') {
                return `<div class="advisor-alert error"><i class="fas fa-times-circle"></i> ${this.escapeHtml(item.message || item.text || item.content)}</div>`;
            }
            return '';
        },
        
        /**
         * Render a metrics block with multiple metrics
         */
        renderMetricsBlock: function(item) {
            if (!item.items || !Array.isArray(item.items)) return '';
            
            let html = '<div class="metrics-row">';
            item.items.forEach(metric => {
                // Pass through all metric properties (sparkline, delta, context, etc.)
                html += this.renderMetric({
                    type: 'metric',
                    label: metric.label,
                    value: metric.value,
                    format: metric.format || 'number',
                    sparkline: metric.sparkline,
                    delta: metric.delta,
                    deltaLabel: metric.deltaLabel,
                    trend: metric.trend,
                    context: metric.context,
                    suffix: metric.suffix
                });
            });
            html += '</div>';
            return html;
        },
        
        /**
         * Render a transaction card (for single transaction results)
         * Dynamically renders ALL properties from the data object
         */
        renderTransactionCard: function(item) {
            // Data can be in item.transaction (new format), item.data (legacy), or directly on item
            const data = item.transaction || item.data || item;
            
            // If data is still a wrapper object, we need to check for actual transaction data
            if (typeof data !== 'object' || data === null) {
                return '<div class="transaction-card"><div class="transaction-card-header">No transaction data</div></div>';
            }
            
            const type = item.transactionType || data.trantype || data.type || 'Transaction';
            const typeIcons = {
                'Invoice': 'fa-file-invoice-dollar',
                'Sales Order': 'fa-shopping-cart',
                'Purchase Order': 'fa-truck',
                'Bill': 'fa-file-invoice',
                'Vendor Bill': 'fa-file-invoice',
                'VendBill': 'fa-file-invoice',
                'Payment': 'fa-money-check-alt',
                'Vendor Payment': 'fa-money-check-alt',
                'Credit Memo': 'fa-receipt',
                'Estimate': 'fa-file-alt',
                'Journal': 'fa-book',
                'Transaction': 'fa-file'
            };
            const icon = typeIcons[type] || 'fa-file';
            
            // Fields to skip in dynamic rendering (internal, redundant, metadata, or already shown in header)
            const skipFields = new Set([
                'id', 'internalid', 'transaction_id',  // Used for deep link, not display
                'posting', 'voided',                    // Internal flags
                'trantype', 'type',                     // Already shown in header badge
                // Metadata fields from the wrapper object (not transaction data)
                'columns', 'formatting', 'title', 'transaction', 
                'data', 'templateformat', 'amount_formatted'
            ]);
            
            // Fields to show prominently in header area
            const headerFields = new Set(['tranid', 'document_number', 'entity', 'vendor_name', 'customer_name', 'amount', 'foreigntotal']);
            
            // Get display values for header
            const displayNumber = data.tranid || data.document_number || '';
            const displayEntity = data.entity || data.vendor_name || data.customer_name || '';
            const displayAmount = data.amount !== undefined ? data.amount : (data.foreigntotal !== undefined ? data.foreigntotal : null);
            
            let html = `<div class="transaction-card">`;
            html += `<div class="transaction-card-header">`;
            html += `<div class="transaction-type-badge"><i class="fas ${icon}"></i> ${this.escapeHtml(type)}</div>`;
            if (displayNumber) {
                html += `<div class="transaction-number">${this.escapeHtml(displayNumber)}</div>`;
            }
            html += `</div>`;
            
            // Primary info (entity and amount)
            if (displayEntity || displayAmount !== null) {
                html += `<div class="transaction-card-primary">`;
                if (displayEntity) {
                    html += `<div class="transaction-entity">${this.escapeHtml(displayEntity)}</div>`;
                }
                if (displayAmount !== null) {
                    html += `<div class="transaction-amount">${this.formatCurrency(displayAmount)}</div>`;
                }
                html += `</div>`;
            }
            
            // Details grid - render ALL other properties dynamically
            html += `<div class="transaction-card-details">`;
            
            // Collect remaining fields to display
            const displayFields = [];
            for (const [key, value] of Object.entries(data)) {
                const keyLower = key.toLowerCase();
                
                // Skip null/undefined, internal fields, and header fields
                if (value === null || value === undefined || value === '') continue;
                if (skipFields.has(keyLower)) continue;
                if (headerFields.has(keyLower)) continue;
                
                // Skip objects and arrays (these are metadata, not display values)
                if (typeof value === 'object') continue;
                
                displayFields.push({ key, value, keyLower });
            }
            
            // Sort fields: dates first, then status, then amounts, then alphabetical
            displayFields.sort((a, b) => {
                const order = (field) => {
                    if (field.keyLower.includes('date')) return 0;
                    if (field.keyLower === 'status') return 1;
                    if (field.keyLower.includes('amount') || field.keyLower.includes('unpaid') || field.keyLower.includes('due')) return 2;
                    return 3;
                };
                const orderDiff = order(a) - order(b);
                if (orderDiff !== 0) return orderDiff;
                return a.key.localeCompare(b.key);
            });
            
            // Render each field
            for (const field of displayFields) {
                const { key, value, keyLower } = field;
                const prettyLabel = this.prettifyColumnName(key);
                let displayValue = value;
                let extraClass = '';
                
                // Format based on field name and type
                if (keyLower === 'status') {
                    // Map NetSuite status codes to human-readable labels (fallback if backend didn't map)
                    const statusMap = {
                        'A': 'Pending Approval',
                        'B': 'Open',
                        'C': 'Closed',
                        'D': 'Cancelled',
                        'E': 'Fully Billed',
                        'F': 'Fulfilled',
                        'G': 'Pending Fulfillment',
                        'H': 'Partially Fulfilled',
                        'P': 'Paid In Full',
                        'V': 'Voided',
                        'R': 'Rejected'
                    };
                    const mappedStatus = (typeof value === 'string' && value.length === 1) ? (statusMap[value] || value) : value;
                    extraClass = this.getStatusClass(mappedStatus);
                    displayValue = `<span class="status-badge ${extraClass}">${this.escapeHtml(mappedStatus)}</span>`;
                } else if (keyLower.includes('date') || keyLower === 'trandate' || keyLower === 'duedate') {
                    displayValue = this.escapeHtml(this.formatDate(value));
                } else if (typeof value === 'number') {
                    // Numeric values - detect if currency
                    if (keyLower.includes('amount') || keyLower.includes('total') || 
                        keyLower.includes('price') || keyLower.includes('cost') ||
                        keyLower.includes('unpaid') || keyLower.includes('paid') ||
                        keyLower.includes('balance')) {
                        displayValue = this.formatCurrency(value);
                    } else if (value >= 0 && value <= 1 && keyLower.includes('rate')) {
                        displayValue = (value * 100).toFixed(1) + '%';
                    } else {
                        displayValue = value.toLocaleString();
                    }
                    displayValue = this.escapeHtml(String(displayValue));
                } else if (typeof value === 'string') {
                    // Check if it's a date string
                    if (value.match(/^\d{4}-\d{2}-\d{2}/)) {
                        displayValue = this.escapeHtml(this.formatDate(value));
                    } else if (value === 'T' || value === 'F') {
                        // Boolean flags
                        displayValue = value === 'T' ? 'Yes' : 'No';
                    } else {
                        displayValue = this.escapeHtml(value);
                    }
                } else {
                    displayValue = this.escapeHtml(String(value));
                }
                
                // Check if it's a long value (memo, notes, etc.)
                const isFullWidth = keyLower.includes('memo') || keyLower.includes('note') || 
                                   keyLower.includes('description') || String(value).length > 50;
                
                html += `<div class="transaction-detail${isFullWidth ? ' full-width' : ''}">`;
                html += `<span class="detail-label">${this.escapeHtml(prettyLabel)}</span>`;
                html += `<span class="detail-value">${displayValue}</span>`;
                html += `</div>`;
            }
            
            html += `</div>`; // details
            
            // Footer with NetSuite deep link - ONLY if numeric id exists
            const internalId = data.id;
            if (internalId && typeof internalId === 'number') {
                const nsUrl = `/app/accounting/transactions/transaction.nl?id=${internalId}`;
                html += `<div class="transaction-card-footer">`;
                html += `<a href="${nsUrl}" target="_blank" class="transaction-link">`;
                html += `<i class="fas fa-external-link-alt"></i> Open in NetSuite`;
                html += `</a>`;
                html += `<span class="transaction-id">ID: ${internalId}</span>`;
                html += `</div>`;
            }
            
            html += `</div>`; // card
            return html;
        },
        
        getNetSuiteRecordType: function(transactionType) {
            const typeMap = {
                'Invoice': 'custinvc',
                'Sales Order': 'salesord',
                'Purchase Order': 'purchord',
                'Vendor Bill': 'vendbill',
                'Bill': 'vendbill',
                'Payment': 'custpymt',
                'Vendor Payment': 'vendpymt',
                'Credit Memo': 'custcred',
                'Estimate': 'estimate',
                'Journal': 'journal',
                'Check': 'check',
                'Deposit': 'deposit',
                'Transfer': 'transfer'
            };
            return typeMap[transactionType] || 'transaction';
        },
        
        /**
         * Format date for display
         */
        formatDate: function(dateStr) {
            if (!dateStr) return '';
            try {
                const date = new Date(dateStr);
                return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            } catch (e) {
                return dateStr;
            }
        },
        
        /**
         * Get status CSS class
         */
        getStatusClass: function(status) {
            const statusLower = (status || '').toLowerCase();
            if (/paid|closed|complete|fulfilled|approved/.test(statusLower)) return 'status-success';
            if (/open|pending|partially/.test(statusLower)) return 'status-warning';
            if (/overdue|rejected|cancelled|void/.test(statusLower)) return 'status-error';
            return 'status-neutral';
        },
        
        /**
         * Prettify column name for display
         * Converts SNAKE_CASE, camelCase, and technical names to readable format
         */
        prettifyColumnName: function(col) {
            if (!col) return '';
            
            // Common abbreviation mappings
            const abbreviations = {
                'ar': 'AR',
                'ap': 'AP',
                'po': 'PO',
                'so': 'SO',
                'gl': 'GL',
                'ytd': 'YTD',
                'mtd': 'MTD',
                'qty': 'Qty',
                'avg': 'Avg',
                'pct': '%',
                'amt': 'Amount',
                'num': 'Number',
                'dt': 'Date',
                'id': 'ID',
                'cogs': 'COGS',
                'ebitda': 'EBITDA'
            };
            
            // Word replacements for common technical terms
            const replacements = {
                'tranid': 'Transaction #',
                'trandate': 'Date',
                'foreigntotal': 'Total',
                'foreignamountunpaid': 'Amount Due',
                'companyname': 'Company',
                'entityid': 'Entity ID',
                'accttype': 'Account Type',
                'accountsearchdisplayname': 'Account',
                'acctnumber': 'Account #',
                'netamount': 'Net Amount',
                'grossprofit': 'Gross Profit',
                'netprofit': 'Net Profit',
                'othincome': 'Other Income',
                'othexpense': 'Other Expense'
            };
            
            // Check for direct replacement first
            const colLower = col.toLowerCase();
            if (replacements[colLower]) {
                return replacements[colLower];
            }
            
            // Convert snake_case and SCREAMING_SNAKE_CASE to spaces
            let pretty = col.replace(/_/g, ' ');
            
            // Convert camelCase to spaces
            pretty = pretty.replace(/([a-z])([A-Z])/g, '$1 $2');
            
            // Lowercase everything first, then capitalize each word
            pretty = pretty.toLowerCase().split(' ').map(word => {
                // Check if it's a known abbreviation
                if (abbreviations[word]) {
                    return abbreviations[word];
                }
                // Capitalize first letter
                return word.charAt(0).toUpperCase() + word.slice(1);
            }).join(' ');
            
            // Clean up any double spaces
            pretty = pretty.replace(/\s+/g, ' ').trim();
            
            return pretty;
        },

        /**
         * Export table to CSV
         */
        exportCSV: function(tableId) {
            const data = this.tableData && this.tableData[tableId];
            if (!data) return;
            
            let csv = data.columns.join(',') + '\n';
            data.rows.forEach(row => {
                const values = data.columns.map(col => {
                    const key = col.toLowerCase().replace(/\s+/g, '_');
                    let val = row[key] !== undefined ? row[key] : (row[col] || '');
                    // Escape quotes and wrap in quotes if contains comma
                    val = String(val).replace(/"/g, '""');
                    if (val.includes(',') || val.includes('\n') || val.includes('"')) {
                        val = '"' + val + '"';
                    }
                    return val;
                });
                csv += values.join(',') + '\n';
            });
            
            // Download
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = 'export.csv';
            link.click();
            URL.revokeObjectURL(url);
        },
        
        /**
         * Copy table to clipboard
         */
        copyTable: function(tableId) {
            const data = this.tableData && this.tableData[tableId];
            if (!data) return;
            
            let text = data.columns.join('\t') + '\n';
            data.rows.forEach(row => {
                const values = data.columns.map(col => {
                    const key = col.toLowerCase().replace(/\s+/g, '_');
                    return row[key] !== undefined ? row[key] : (row[col] || '');
                });
                text += values.join('\t') + '\n';
            });
            
            navigator.clipboard.writeText(text).then(() => {
                // Show feedback
                const wrapper = document.getElementById(`${tableId}-wrapper`);
                const btn = wrapper && wrapper.querySelector('.table-action-btn:nth-child(2)');
                if (btn) {
                    const original = btn.innerHTML;
                    btn.innerHTML = '<i class="fas fa-check"></i>';
                    setTimeout(() => { btn.innerHTML = original; }, 2000);
                }
            });
        },
        
        /**
         * Format number based on column name
         */
        formatNumber: function(val, col) {
            const colLower = col.toLowerCase();
            
            const isCurrency = /amount|revenue|total|cost|price|balance|payment|invoice|sales|profit|cogs|expense|income/.test(colLower);
            const isNotCurrency = /hour|count|qty|quantity|days|rate|percent|pct|number|id|transaction/.test(colLower);
            
            if (isCurrency && !isNotCurrency) {
                return '$' + val.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
            }
            return val.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
        },
        
        /**
         * Format currency value
         */
        formatCurrency: function(val) {
            if (val === null || val === undefined) return '$0';
            const num = typeof val === 'number' ? val : parseFloat(val);
            if (isNaN(num)) return '$0';
            const isNegative = num < 0;
            const formatted = '$' + Math.abs(num).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            return isNegative ? '-' + formatted : formatted;
        },
        
        /**
         * Render a metric card with optional delta/trend
         */
        renderMetric: function(item) {
            let valueStr = item.value;
            
            // Format value based on format type
            if (item.format === 'currency' && typeof item.value === 'number') {
                // Use compact format for large numbers
                if (Math.abs(item.value) >= 1000000) {
                    valueStr = '$' + (item.value / 1000000).toFixed(1) + 'M';
                } else if (Math.abs(item.value) >= 1000) {
                    valueStr = '$' + (item.value / 1000).toFixed(0) + 'k';
                } else {
                    valueStr = '$' + item.value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
                }
            } else if (item.format === 'percent' && typeof item.value === 'number') {
                valueStr = item.value.toFixed(1) + '%';
            } else if (typeof item.value === 'number') {
                valueStr = item.value.toLocaleString('en-US');
            }
            
            // Build delta/trend indicator
            let deltaHtml = '';
            if (item.delta !== undefined && item.delta !== null) {
                const isPositive = item.delta > 0 || item.trend === 'up';
                const icon = isPositive ? 'fa-arrow-up' : 'fa-arrow-down';
                const colorClass = isPositive ? 'trend-up' : 'trend-down';
                const sign = item.delta > 0 ? '+' : '';
                deltaHtml = `<span class="metric-delta ${colorClass}"><i class="fas ${icon}"></i> ${sign}${item.delta}%</span>`;
            }
            
            // Calculate font size based on label length
            const label = item.label || '';
            let labelClass = '';
            if (label.length > 30) {
                labelClass = 'metric-label-xs';
            } else if (label.length > 20) {
                labelClass = 'metric-label-sm';
            }
            
            // Build sparkline if provided
            let sparklineHtml = '';
            if (item.sparkline && Array.isArray(item.sparkline) && item.sparkline.length > 1) {
                const values = item.sparkline;
                const maxVal = Math.max(...values);
                const minVal = Math.min(...values);
                const range = maxVal - minVal || 1;
                const height = 24;
                // Use viewBox for responsive scaling - sparkline will stretch to full width
                const viewBoxWidth = 100;
                
                const points = values.map((v, i) => {
                    const x = (i / (values.length - 1 || 1)) * viewBoxWidth;
                    const y = height - ((v - minVal) / range) * height;
                    return `${x},${y}`;
                }).join(' ');
                
                sparklineHtml = `
                    <div class="metric-sparkline" style="width:100%;margin-top:8px;">
                        <svg width="100%" height="${height}" viewBox="0 0 ${viewBoxWidth} ${height}" preserveAspectRatio="none">
                            <polyline points="${points}" fill="none" stroke="#3b82f6" stroke-width="1.5"/>
                        </svg>
                    </div>
                `;
            }
            
            return `
                <div class="metric-card">
                    <div class="metric-value">${this.escapeHtml(String(valueStr))}</div>
                    <div class="metric-label ${labelClass}" title="${this.escapeHtml(label)}">${this.escapeHtml(label)}${deltaHtml}</div>
                    ${sparklineHtml}
                </div>
            `;
        },
        
        /**
         * Render a chart (bar, line, pie)
         */
        renderChart: function(item) {
            // Check for various data formats before rendering
            let hasData = false;
            if (Array.isArray(item.data) && item.data.length > 0) {
                hasData = true;
            } else if (item.data && item.data.labels && item.data.labels.length > 0) {
                // Chart.js format or { labels, values } format
                hasData = true;
            }
            
            if (!hasData) return '';
            
            const chartId = 'chart-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
            const chartType = item.chartType || 'bar';
            
            // Store chart config for later rendering
            if (!window.advisorCharts) window.advisorCharts = {};
            window.advisorCharts[chartId] = item;
            
            let html = `<div class="chart-container">`;
            if (item.title) {
                html += `<div class="chart-title">${this.escapeHtml(item.title)}</div>`;
            }
            html += `<div id="${chartId}" class="advisor-chart" data-chart-type="${chartType}"></div>`;
            html += `</div>`;
            
            // Defer chart rendering - try multiple times in case DOM isn't ready
            const self = this;
            const tryRender = function(attempt) {
                try {
                    const el = document.getElementById(chartId);
                    if (el) {
                        console.log('[Dashboard.Advisor] Chart container found on attempt', attempt);
                        self.renderChartElement(chartId, item);
                    } else if (attempt < 5) {
                        console.log('[Dashboard.Advisor] Chart container not found, retry', attempt + 1);
                        setTimeout(function() { tryRender(attempt + 1); }, 100);
                    } else {
                        console.error('[Dashboard.Advisor] Chart container never found:', chartId);
                    }
                } catch (err) {
                    console.error('[Dashboard.Advisor] Error in deferred chart render:', err);
                }
            };
            setTimeout(function() { tryRender(1); }, 50);
            
            return html;
        },
        
        /**
         * Actually render the chart element using simple SVG
         */
        renderChartElement: function(chartId, item) {
            console.log('[Dashboard.Advisor] renderChartElement called:', chartId, item);
            const container = document.getElementById(chartId);
            if (!container) {
                console.error('[Dashboard.Advisor] Chart container not found:', chartId);
                return;
            }
            
            let data = item.data;
            const chartType = item.chartType || 'bar';
            console.log('[Dashboard.Advisor] Chart type:', chartType, 'Raw data:', data);
            
            // Handle Chart.js format: { labels: [...], datasets: [{ data: [...] }] }
            if (data && !Array.isArray(data) && data.labels && data.datasets) {
                console.log('[Dashboard.Advisor] Converting Chart.js format');
                const labels = data.labels;
                const firstDataset = data.datasets[0] || {};
                const values = firstDataset.data || [];
                data = labels.map((label, i) => ({
                    label: label,
                    value: values[i] || 0
                }));
                console.log('[Dashboard.Advisor] Converted to array:', data.length, 'items');
            }
            
            // Handle object format: { labels: [...], values: [...] }
            if (data && !Array.isArray(data) && data.labels && data.values) {
                console.log('[Dashboard.Advisor] Converting labels/values format:', data);
                const labels = data.labels;
                const values = data.values;
                data = labels.map((label, i) => ({
                    label: label,
                    value: values[i] || 0
                }));
            }
            
            // Ensure data is an array at this point
            if (!Array.isArray(data)) {
                console.error('[Dashboard.Advisor] Chart data is not an array after conversion:', data);
                container.innerHTML = '<div class="chart-empty">Invalid chart data format</div>';
                return;
            }
            
            if (data.length === 0) {
                console.warn('[Dashboard.Advisor] Chart data array is empty');
                container.innerHTML = '<div class="chart-empty">No data available</div>';
                return;
            }
            
            // Auto-detect label and value fields if not explicitly provided
            // The AI might return { vendor: "...", increase: 123 } instead of { label: "...", value: 123 }
            // Also handle xKey/yKey (common AI output format)
            if (data && data.length > 0) {
                const firstItem = data[0];
                const keys = Object.keys(firstItem);
                
                // Find label field (string type, typically first)
                // Check multiple aliases: labelField, xField, xKey
                let labelField = item.labelField || item.xField || item.xKey || null;
                let valueField = item.valueField || item.yField || item.yKey || null;
                
                // Auto-detect if specified fields don't exist in data or weren't specified
                if (!labelField || !valueField || !(labelField in firstItem) || !(valueField in firstItem)) {
                    // Find the first string field as label, first number field as value
                    let detectedLabel = null;
                    let detectedValue = null;
                    for (const key of keys) {
                        if (typeof firstItem[key] === 'string' && !detectedLabel) {
                            detectedLabel = key;
                        }
                        if (typeof firstItem[key] === 'number' && !detectedValue) {
                            detectedValue = key;
                        }
                    }
                    
                    // Use detected fields if original fields don't exist in data
                    if (!labelField || !(labelField in firstItem)) {
                        labelField = detectedLabel || keys[0];
                    }
                    if (!valueField || !(valueField in firstItem)) {
                        valueField = detectedValue || keys[1];
                    }
                }
                
                // Normalize data to have label/value
                data = data.map(d => ({
                    label: d[labelField] || d.label || d.name || 'Unknown',
                    value: parseFloat(d[valueField]) || parseFloat(d.value) || parseFloat(d.amount) || 0,
                    originalData: d // Keep original for tooltips
                }));
            }
            
            // Simple SVG bar chart
            if (chartType === 'bar') {
                if (!data || data.length === 0) {
                    container.innerHTML = '<div class="chart-empty">No data available</div>';
                    return;
                }
                
                const maxVal = Math.max(...data.map(d => Math.abs(d.value)));
                const barHeight = 24;
                const padding = 4;
                const labelWidth = 120;
                const chartWidth = container.clientWidth || 400;
                const barWidth = chartWidth - labelWidth - 80;
                
                let svg = `<svg width="100%" height="${data.length * (barHeight + padding) + padding}" class="bar-chart">`;
                
                data.forEach((d, i) => {
                    const y = i * (barHeight + padding) + padding;
                    const width = maxVal > 0 ? (Math.abs(d.value) / maxVal) * barWidth : 0;
                    const color = d.value >= 0 ? 'var(--primary)' : 'var(--danger)';
                    const formattedVal = typeof d.value === 'number' 
                        ? (Math.abs(d.value) >= 1000 ? '$' + (d.value/1000).toFixed(1) + 'k' : '$' + d.value.toLocaleString())
                        : d.value;
                    const labelText = String(d.label || '').substring(0, 18);
                    
                    svg += `<text x="0" y="${y + barHeight/2 + 4}" class="bar-label">${this.escapeHtml(labelText)}</text>`;
                    svg += `<rect x="${labelWidth}" y="${y}" width="${Math.max(width, 2)}" height="${barHeight}" fill="${color}" rx="3"/>`;
                    svg += `<text x="${labelWidth + width + 5}" y="${y + barHeight/2 + 4}" class="bar-value">${formattedVal}</text>`;
                });
                
                svg += `</svg>`;
                container.innerHTML = svg;
            }
            // Simple pie chart
            else if (chartType === 'pie') {
                const total = data.reduce((sum, d) => sum + Math.abs(d.value), 0);
                const size = Math.min(container.clientWidth || 200, 200);
                const radius = size / 2 - 10;
                const cx = size / 2;
                const cy = size / 2;
                const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];
                
                let svg = `<svg width="${size}" height="${size}" class="pie-chart">`;
                let startAngle = 0;
                
                data.forEach((d, i) => {
                    const sliceAngle = (Math.abs(d.value) / total) * 2 * Math.PI;
                    const endAngle = startAngle + sliceAngle;
                    const x1 = cx + radius * Math.cos(startAngle);
                    const y1 = cy + radius * Math.sin(startAngle);
                    const x2 = cx + radius * Math.cos(endAngle);
                    const y2 = cy + radius * Math.sin(endAngle);
                    const largeArc = sliceAngle > Math.PI ? 1 : 0;
                    const color = colors[i % colors.length];
                    
                    svg += `<path d="M ${cx} ${cy} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} Z" fill="${color}"/>`;
                    startAngle = endAngle;
                });
                
                svg += `</svg>`;
                
                // Add legend
                let legend = '<div class="pie-legend">';
                data.forEach((d, i) => {
                    const color = colors[i % colors.length];
                    const pct = total > 0 ? ((Math.abs(d.value) / total) * 100).toFixed(1) : 0;
                    legend += `<span class="legend-item"><span class="legend-color" style="background:${color}"></span>${this.escapeHtml(d.label)} (${pct}%)</span>`;
                });
                legend += '</div>';
                
                container.innerHTML = svg + legend;
            }
            // Line chart (simple)
            else if (chartType === 'line') {
                console.log('[Dashboard.Advisor] Rendering line chart with data:', data);
                try {
                    const maxVal = Math.max(...data.map(d => d.value));
                    const minVal = Math.min(...data.map(d => d.value));
                    const range = maxVal - minVal || 1;
                    const chartWidth = container.clientWidth || 300;
                    const chartHeight = 150;
                    const padding = 40;
                    const bottomPadding = 50; // Extra space for labels
                    
                    console.log('[Dashboard.Advisor] Line chart params:', { maxVal, minVal, range, chartWidth, chartHeight });
                    
                    const points = data.map((d, i) => {
                        const x = padding + (i / (data.length - 1 || 1)) * (chartWidth - 2 * padding);
                        const y = chartHeight - bottomPadding - ((d.value - minVal) / range) * (chartHeight - padding - bottomPadding);
                        return `${x},${y}`;
                    }).join(' ');
                    
                    let svg = `<svg width="100%" height="${chartHeight}" viewBox="0 0 ${chartWidth} ${chartHeight}" class="line-chart">`;
                    svg += `<polyline points="${points}" fill="none" stroke="var(--primary)" stroke-width="2"/>`;
                    
                    // Add dots and X-axis labels
                    data.forEach((d, i) => {
                        const x = padding + (i / (data.length - 1 || 1)) * (chartWidth - 2 * padding);
                        const y = chartHeight - bottomPadding - ((d.value - minVal) / range) * (chartHeight - padding - bottomPadding);
                        svg += `<circle cx="${x}" cy="${y}" r="4" fill="var(--primary)"/>`;
                        
                        // Add X-axis labels (show every nth label to avoid crowding)
                        const showLabel = data.length <= 6 || i % Math.ceil(data.length / 6) === 0 || i === data.length - 1;
                        if (showLabel) {
                            const labelText = String(d.label || '').substring(0, 8);
                            svg += `<text x="${x}" y="${chartHeight - 10}" text-anchor="middle" class="chart-label" font-size="10">${this.escapeHtml(labelText)}</text>`;
                        }
                    });
                    
                    svg += `</svg>`;
                    console.log('[Dashboard.Advisor] Line chart SVG length:', svg.length);
                    container.innerHTML = svg;
                } catch (lineErr) {
                    console.error('[Dashboard.Advisor] Line chart error:', lineErr);
                    container.innerHTML = '<div class="chart-empty">Error rendering chart</div>';
                }
            }
        },
        
        /**
         * Render a sparkline
         */
        renderSparkline: function(item) {
            if (!item.data || item.data.length === 0) return '';
            
            const values = item.data;
            const maxVal = Math.max(...values);
            const minVal = Math.min(...values);
            const range = maxVal - minVal || 1;
            const width = 80;
            const height = 20;
            
            const points = values.map((v, i) => {
                const x = (i / (values.length - 1 || 1)) * width;
                const y = height - ((v - minVal) / range) * height;
                return `${x},${y}`;
            }).join(' ');
            
            return `
                <span class="sparkline-container">
                    ${item.label ? `<span class="sparkline-label">${this.escapeHtml(item.label)}</span>` : ''}
                    <svg width="${width}" height="${height}" class="sparkline">
                        <polyline points="${points}" fill="none" stroke="var(--primary)" stroke-width="1.5"/>
                    </svg>
                </span>
            `;
        },
        
        /**
         * Render all messages from session
         */
        renderAllMessages: function() {
            if (messages.length === 0) return;
            
            const welcome = document.getElementById('advisor-welcome-full');
            if (welcome) welcome.style.display = 'none';
            
            // Track last user query for older messages without userQuery stored
            let lastUserQuery = '';
            messages.forEach(msg => {
                if (msg.role === 'user') {
                    lastUserQuery = msg.content;
                } else if (msg.role === 'assistant' && !msg.userQuery) {
                    // Backfill userQuery for older messages
                    msg.userQuery = lastUserQuery;
                }
                this.renderMessage(msg);
            });
            this.scrollToBottom();
        },
        
        /**
         * Scroll chat to bottom
         */
        scrollToBottom: function() {
            const container = document.getElementById('advisor-messages-full');
            if (container) {
                requestAnimationFrame(() => {
                    container.scrollTop = container.scrollHeight;
                });
            }
        },
        
        /**
         * Clear chat history
         */
        clearChat: function() {
            messages = [];
            sessionContext = { 
                resolvedEntities: {},
                entityOrder: [],
                topics: [],
                queryHistory: []
            };  // Reset entity cache and context
            this.saveSession();
            
            const container = document.getElementById('advisor-messages-full');
            if (container) {
                // Keep only the welcome hero
                const welcome = container.querySelector('.advisor-hero');
                container.innerHTML = '';
                if (welcome) {
                    container.appendChild(welcome);
                    welcome.style.display = '';
                }
            }
            
            // Re-bind suggestion chip events
            this.bindEvents();
        },
        
        /**
         * Save session to storage
         */
        saveSession: function() {
            try {
                const data = {
                    messages: messages.slice(-MAX_HISTORY),
                    sessionContext: sessionContext,  // Persist entity resolutions
                    timestamp: Date.now()
                };
                sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data));
            } catch (e) {
                console.warn('[Advisor] Save failed:', e);
            }
        },
        
        /**
         * Load session from storage
         */
        loadSession: function() {
            try {
                const data = sessionStorage.getItem(STORAGE_KEY);
                if (data) {
                    const parsed = JSON.parse(data);
                    messages = parsed.messages || [];
                    // Load full sessionContext with all fields, with defaults for missing
                    sessionContext = parsed.sessionContext || {};
                    sessionContext.resolvedEntities = sessionContext.resolvedEntities || {};
                    sessionContext.entityOrder = sessionContext.entityOrder || [];
                    sessionContext.topics = sessionContext.topics || [];
                    sessionContext.queryHistory = sessionContext.queryHistory || [];
                }
            } catch (e) {
                messages = [];
                sessionContext = { 
                    resolvedEntities: {},
                    entityOrder: [],
                    topics: [],
                    queryHistory: []
                };
            }
        },
        
        /**
         * Format text with basic markdown support (headers, bold, italic, lists)
         * Note: Tables are extracted by backend and rendered as richContent
         */
        formatText: function(text) {
            if (!text) return '';
            
            // Strip Cohere citation tags: <co>text</co: 0:[...]> -> text
            text = text.replace(/<co>([^<]*)<\/co:[^>]*>/g, '$1');
            
            // Escape HTML first
            let html = text
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
            
            // Headers (### Header -> <h4>, ## Header -> <h3>)
            html = html.replace(/^### (.+)$/gm, '<h4 class="md-heading">$1</h4>');
            html = html.replace(/^## (.+)$/gm, '<h3 class="md-heading">$1</h3>');
            html = html.replace(/^# (.+)$/gm, '<h2 class="md-heading">$1</h2>');
            
            // Bold and italic
            html = html.replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>');
            html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
            html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
            
            // Inline code
            html = html.replace(/`(.*?)`/g, '<code class="md-code">$1</code>');
            
            // Unordered lists (- item or * item at start of line)
            // Convert list items
            html = html.replace(/^[\-\*]\s+(.+)$/gm, '<li>$1</li>');
            // Wrap consecutive <li> in <ul>
            html = html.replace(/(<li>.*<\/li>\n?)+/g, function(match) {
                return '<ul class="md-list">' + match + '</ul>';
            });
            
            // Numbered lists
            html = html.replace(/^\d+\.\s+(.+)$/gm, '<li>$1</li>');
            
            // Line breaks - but NOT inside lists
            html = html.replace(/\n/g, '<br>');
            
            // Clean up extra <br> around block elements
            html = html.replace(/<br>\s*(<h[234]|<ul|<\/ul|<\/h[234]>)/g, '$1');
            html = html.replace(/(<\/h[234]>|<\/ul>)\s*<br>/g, '$1');
            
            // Clean up <br> between list items (inside <ul>)
            html = html.replace(/<\/li><br>\s*<li>/g, '</li><li>');
            html = html.replace(/<\/li><br>\s*<\/ul>/g, '</li></ul>');
            html = html.replace(/<ul class="md-list"><br>/g, '<ul class="md-list">');
            
            return html;
        },
        
        /**
         * Copy response to clipboard
         */
        copyResponse: function(msgId) {
            const msgEl = document.getElementById(msgId);
            if (!msgEl) return;
            
            const bubble = msgEl.closest('.message-bubble');
            if (!bubble) return;
            
            // Get text content (skip action buttons)
            const textEl = bubble.querySelector('.message-text');
            const text = textEl ? textEl.textContent : '';
            
            navigator.clipboard.writeText(text).then(() => {
                // Show feedback
                const btn = msgEl.querySelector('.action-btn');
                if (btn) {
                    const original = btn.innerHTML;
                    btn.innerHTML = '<i class="fas fa-check"></i> Copied';
                    btn.classList.add('copy-success');
                    setTimeout(() => {
                        btn.innerHTML = original;
                        btn.classList.remove('copy-success');
                    }, 2000);
                }
            });
        },
        
        /**
         * Print response (opens print dialog for PDF save)
         */
        printResponse: function(msgId) {
            const msgEl = document.getElementById(msgId);
            if (!msgEl) return;
            
            const bubble = msgEl.closest('.message-bubble');
            if (!bubble) return;
            
            // Create print-friendly version
            const printContent = bubble.cloneNode(true);
            
            // Remove action buttons from print version
            const actions = printContent.querySelector('.response-actions');
            if (actions) actions.remove();
            
            // Open print window
            const printWindow = window.open('', '_blank');
            printWindow.document.write(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Advisor Response</title>
                    <style>
                        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 40px; max-width: 800px; margin: 0 auto; }
                        table { border-collapse: collapse; width: 100%; margin: 16px 0; }
                        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
                        th { background: #f5f5f5; }
                        .model-badge { display: none; }
                        @media print { body { padding: 20px; } }
                    </style>
                </head>
                <body>${printContent.innerHTML}</body>
                </html>
            `);
            printWindow.document.close();
            printWindow.print();
        },
        
        /**
         * Escape HTML entities
         */
        escapeHtml: function(text) {
            if (text === null || text === undefined) return '';
            const div = document.createElement('div');
            div.textContent = String(text);
            return div.innerHTML;
        }
    };

    // Register with router
    if (window.Router) {
        Router.register('advisor', 
            () => AdvisorController.init(),
            () => AdvisorController.cleanup()
        );
    }

    // Export
    window.AdvisorController = AdvisorController;
    window.AdvisorChat = AdvisorController; // Alias for onclick handlers

})(window);