/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @module Lib_Core
 * @description Core utilities and shared functions for Gantry backend modules.
 *              Provides date handling, query helpers, period system, and common operations.
 *              PERIOD SYSTEM: Single source of truth for all date period definitions.
 */
define(['N/query', 'N/search', 'N/runtime', 'N/format', 'N/log', './Lib_Config'],
function(query, search, runtime, format, log, ConfigLib) {
    'use strict';

    // ==========================================
    // DATE UTILITIES
    // ==========================================

    /**
     * Parse date range from request parameters
     * @param {Object} params - Request parameters
     * @returns {Object} { startDate: Date, endDate: Date, preset: string }
     */
    function parseDateRange(params) {
        let startDate, endDate;
        const preset = params.datePreset || params.preset;
        const today = new Date();
        
        if (params.startDate && params.endDate) {
            // Explicit dates provided
            startDate = parseDate(params.startDate);
            endDate = parseDate(params.endDate);
        } else if (preset) {
            // Calculate from preset
            const range = calculatePresetRange(preset, today);
            startDate = range.start;
            endDate = range.end;
        } else {
            // Default to YTD
            const range = calculatePresetRange('YTD', today);
            startDate = range.start;
            endDate = range.end;
        }

        return {
            startDate: startDate,
            endDate: endDate,
            startDateStr: formatDateForQuery(startDate),
            endDateStr: formatDateForQuery(endDate),
            preset: preset || 'YTD'
        };
    }

    /**
     * Parse a date string or Date object
     * @param {string|Date} dateInput
     * @returns {Date}
     */
    function parseDate(dateInput) {
        if (dateInput instanceof Date) return dateInput;
        if (!dateInput) return new Date();
        
        // Try parsing as ISO string
        const parsed = new Date(dateInput);
        if (!isNaN(parsed.getTime())) return parsed;
        
        // Try MM/DD/YYYY format
        const parts = dateInput.split('/');
        if (parts.length === 3) {
            return new Date(parts[2], parts[0] - 1, parts[1]);
        }
        
        return new Date();
    }

    /**
     * Format date for SuiteQL queries
     * @param {Date} date
     * @returns {string} YYYY-MM-DD format
     */
    function formatDateForQuery(date) {
        if (!date) return null;
        const d = date instanceof Date ? date : new Date(date);
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    /**
     * Format date for display
     * @param {Date} date
     * @param {string} [formatType='short'] - 'short', 'medium', 'long'
     * @returns {string}
     */
    function formatDateForDisplay(date, formatType = 'short') {
        if (!date) return '';
        const d = date instanceof Date ? date : new Date(date);
        
        switch (formatType) {
            case 'long':
                return d.toLocaleDateString('en-US', {
                    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
                });
            case 'medium':
                return d.toLocaleDateString('en-US', {
                    year: 'numeric', month: 'short', day: 'numeric'
                });
            case 'short':
            default:
                return d.toLocaleDateString('en-US');
        }
    }

    /**
     * Calculate date range for a preset
     * @param {string} preset - MTD, QTD, YTD, L30, L60, L90, L12M
     * @param {Date} [asOf] - Reference date (defaults to today)
     * @returns {Object} { start: Date, end: Date }
     */
    function calculatePresetRange(preset, asOf) {
        const today = asOf || new Date();
        let start, end;
        
        switch (preset?.toUpperCase()) {
            case 'MTD':
                start = new Date(today.getFullYear(), today.getMonth(), 1);
                end = today;
                break;
                
            case 'QTD':
                const quarterMonth = Math.floor(today.getMonth() / 3) * 3;
                start = new Date(today.getFullYear(), quarterMonth, 1);
                end = today;
                break;
                
            case 'YTD':
                start = new Date(today.getFullYear(), 0, 1);
                end = today;
                break;
                
            case 'L30':
            case 'LAST30':
                start = new Date(today);
                start.setDate(start.getDate() - 30);
                end = today;
                break;
                
            case 'L60':
            case 'LAST60':
                start = new Date(today);
                start.setDate(start.getDate() - 60);
                end = today;
                break;
                
            case 'L90':
            case 'LAST90':
                start = new Date(today);
                start.setDate(start.getDate() - 90);
                end = today;
                break;
                
            case 'L12M':
            case 'LAST12M':
                start = new Date(today);
                start.setFullYear(start.getFullYear() - 1);
                end = today;
                break;
                
            case 'FYTD':
                // Fiscal YTD - assumes July start, adjust as needed
                const fiscalStartMonth = 6; // July = 6 (0-indexed)
                if (today.getMonth() >= fiscalStartMonth) {
                    start = new Date(today.getFullYear(), fiscalStartMonth, 1);
                } else {
                    start = new Date(today.getFullYear() - 1, fiscalStartMonth, 1);
                }
                end = today;
                break;
                
            default:
                // Default to YTD
                start = new Date(today.getFullYear(), 0, 1);
                end = today;
        }
        
        return { start, end };
    }

    /**
     * Get prior year date range
     * @param {Date} startDate
     * @param {Date} endDate
     * @returns {Object} { start: Date, end: Date }
     */
    function getPriorYearRange(startDate, endDate) {
        const pyStart = new Date(startDate);
        pyStart.setFullYear(pyStart.getFullYear() - 1);
        
        const pyEnd = new Date(endDate);
        pyEnd.setFullYear(pyEnd.getFullYear() - 1);
        
        return { start: pyStart, end: pyEnd };
    }

    /**
     * Get prior period (same number of days before start date)
     * @param {Date} startDate
     * @param {Date} endDate
     * @returns {Object} { start: Date, end: Date }
     */
    function getPriorPeriodRange(startDate, endDate) {
        const days = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));

        const ppEnd = new Date(startDate);
        ppEnd.setDate(ppEnd.getDate() - 1);

        const ppStart = new Date(ppEnd);
        ppStart.setDate(ppStart.getDate() - days);

        return { start: ppStart, end: ppEnd };
    }

    // ==========================================
    // UNIFIED PERIOD SYSTEM - Single Source of Truth
    // Add a period here ONCE - automatically available everywhere:
    // - Data modules via getPeriodDates()
    // - SQL queries via buildPeriodFilter()
    // - LLM prompts via getAvailablePeriods()
    // ==========================================

    /**
     * Build fiscal context with all computed dates
     * Used by both dates() and sql() functions in PERIOD_DEFINITIONS
     * @returns {Object} Fiscal context with all computed date strings
     */
    function buildFiscalContext() {
        const fiscalCalendar = ConfigLib.getFiscalCalendar();
        const now = new Date();
        const fyStart = new Date(fiscalCalendar.fiscalYearStartDate);
        const fyEnd = new Date(fiscalCalendar.fiscalYearEndDate);

        // Helper to format date for SQL (YYYY-MM-DD)
        const toSqlDate = (d) => {
            const year = d.getFullYear();
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        };

        // Calculate fiscal quarters
        const getFiscalQuarterDates = (fyStartDate, quarterNum) => {
            const fy = new Date(fyStartDate);
            const qStart = new Date(fy);
            qStart.setMonth(fy.getMonth() + (quarterNum - 1) * 3);
            const qEnd = new Date(qStart);
            qEnd.setMonth(qStart.getMonth() + 3);
            qEnd.setDate(qEnd.getDate() - 1);
            return { start: toSqlDate(qStart), end: toSqlDate(qEnd) };
        };

        // Last fiscal year
        const lastFyStart = new Date(fyStart);
        lastFyStart.setFullYear(lastFyStart.getFullYear() - 1);
        const lastFyEnd = new Date(fyEnd);
        lastFyEnd.setFullYear(lastFyEnd.getFullYear() - 1);

        // 2 fiscal years ago
        const twoFyStart = new Date(fyStart);
        twoFyStart.setFullYear(twoFyStart.getFullYear() - 2);
        const twoFyEnd = new Date(fyEnd);
        twoFyEnd.setFullYear(twoFyEnd.getFullYear() - 2);

        // 3 fiscal years ago
        const threeFyStart = new Date(fyStart);
        threeFyStart.setFullYear(threeFyStart.getFullYear() - 3);
        const threeFyEnd = new Date(fyEnd);
        threeFyEnd.setFullYear(threeFyEnd.getFullYear() - 3);

        // YTD comparison point in prior year (same elapsed time)
        const daysIntoFy = Math.floor((now - fyStart) / (1000 * 60 * 60 * 24));
        const priorYtdEnd = new Date(lastFyStart);
        priorYtdEnd.setDate(priorYtdEnd.getDate() + daysIntoFy);

        // Calendar helpers
        const todayStr = toSqlDate(now);

        // Start of current week (Monday)
        const weekStart = new Date(now);
        const dayOfWeek = weekStart.getDay();
        const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
        weekStart.setDate(weekStart.getDate() - daysToMonday);

        // Last week
        const lastWeekStart = new Date(weekStart);
        lastWeekStart.setDate(lastWeekStart.getDate() - 7);
        const lastWeekEnd = new Date(weekStart);
        lastWeekEnd.setDate(lastWeekEnd.getDate() - 1);

        // This month
        const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);

        // Last month
        const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);

        // This quarter
        const quarterMonth = Math.floor(now.getMonth() / 3) * 3;
        const thisQuarterStart = new Date(now.getFullYear(), quarterMonth, 1);

        // Last quarter
        const lastQuarterStart = new Date(now.getFullYear(), quarterMonth - 3, 1);
        const lastQuarterEnd = new Date(now.getFullYear(), quarterMonth, 0);

        return {
            today: todayStr,
            fyStartDate: fiscalCalendar.fiscalYearStartDate,
            fyEndDate: fiscalCalendar.fiscalYearEndDate,
            lastFyStart: toSqlDate(lastFyStart),
            lastFyEnd: toSqlDate(lastFyEnd),
            twoFyStart: toSqlDate(twoFyStart),
            twoFyEnd: toSqlDate(twoFyEnd),
            threeFyStart: toSqlDate(threeFyStart),
            threeFyEnd: toSqlDate(threeFyEnd),
            priorYtdEnd: toSqlDate(priorYtdEnd),
            closedPeriodEnd: fiscalCalendar.latestClosedPeriod ?
                fiscalCalendar.latestClosedPeriod.endDate : todayStr,
            // Calendar dates
            weekStart: toSqlDate(weekStart),
            lastWeekStart: toSqlDate(lastWeekStart),
            lastWeekEnd: toSqlDate(lastWeekEnd),
            thisMonthStart: toSqlDate(thisMonthStart),
            lastMonthStart: toSqlDate(lastMonthStart),
            lastMonthEnd: toSqlDate(lastMonthEnd),
            thisQuarterStart: toSqlDate(thisQuarterStart),
            lastQuarterStart: toSqlDate(lastQuarterStart),
            lastQuarterEnd: toSqlDate(lastQuarterEnd),
            // Current FY quarters
            fyQ1: getFiscalQuarterDates(fyStart, 1),
            fyQ2: getFiscalQuarterDates(fyStart, 2),
            fyQ3: getFiscalQuarterDates(fyStart, 3),
            fyQ4: getFiscalQuarterDates(fyStart, 4),
            // Last FY quarters
            lastFyQ1: getFiscalQuarterDates(lastFyStart, 1),
            lastFyQ2: getFiscalQuarterDates(lastFyStart, 2),
            lastFyQ3: getFiscalQuarterDates(lastFyStart, 3),
            lastFyQ4: getFiscalQuarterDates(lastFyStart, 4)
        };
    }

    /**
     * PERIOD_DEFINITIONS - Single Source of Truth
     * Each period has:
     * - desc: Human-readable description (shown to LLM)
     * - category: Grouping for organization
     * - dates(ctx): Returns {start, end} date strings for data modules
     * - sql(df, ctx): Returns SQL WHERE clause fragment for queries
     */
    const PERIOD_DEFINITIONS = {
        // === Daily ===
        'today': {
            desc: 'Current day only',
            category: 'daily',
            dates: (ctx) => ({ start: ctx.today, end: ctx.today }),
            sql: (df) => `${df} = CURRENT_DATE`
        },
        'yesterday': {
            desc: 'Previous day only',
            category: 'daily',
            dates: (ctx) => {
                const d = new Date();
                d.setDate(d.getDate() - 1);
                const str = formatDateForQuery(d);
                return { start: str, end: str };
            },
            sql: (df) => `${df} = CURRENT_DATE - 1`
        },

        // === Weekly ===
        'this_week': {
            desc: 'Current week (Monday to now)',
            category: 'weekly',
            dates: (ctx) => ({ start: ctx.weekStart, end: ctx.today }),
            sql: (df) => `${df} >= TRUNC(CURRENT_DATE, 'IW')`
        },
        'last_week': {
            desc: 'Previous full week',
            category: 'weekly',
            dates: (ctx) => ({ start: ctx.lastWeekStart, end: ctx.lastWeekEnd }),
            sql: (df) => `${df} >= TRUNC(CURRENT_DATE, 'IW') - 7 AND ${df} < TRUNC(CURRENT_DATE, 'IW')`
        },

        // === Monthly ===
        'this_month': {
            desc: 'Current calendar month',
            category: 'monthly',
            dates: (ctx) => ({ start: ctx.thisMonthStart, end: ctx.today }),
            sql: (df) => `${df} >= TRUNC(CURRENT_DATE, 'MM')`
        },
        'last_month': {
            desc: 'Previous calendar month',
            category: 'monthly',
            dates: (ctx) => ({ start: ctx.lastMonthStart, end: ctx.lastMonthEnd }),
            sql: (df) => `${df} >= ADD_MONTHS(TRUNC(CURRENT_DATE, 'MM'), -1) AND ${df} < TRUNC(CURRENT_DATE, 'MM')`
        },
        'mtd': {
            desc: 'Month to date (alias for this_month)',
            category: 'monthly',
            dates: (ctx) => ({ start: ctx.thisMonthStart, end: ctx.today }),
            sql: (df) => `${df} >= TRUNC(CURRENT_DATE, 'MM')`
        },

        // === Calendar Quarters ===
        'this_quarter': {
            desc: 'Current calendar quarter',
            category: 'quarterly',
            dates: (ctx) => ({ start: ctx.thisQuarterStart, end: ctx.today }),
            sql: (df) => `${df} >= TRUNC(CURRENT_DATE, 'Q')`
        },
        'last_quarter': {
            desc: 'Previous calendar quarter',
            category: 'quarterly',
            dates: (ctx) => ({ start: ctx.lastQuarterStart, end: ctx.lastQuarterEnd }),
            sql: (df) => `${df} >= ADD_MONTHS(TRUNC(CURRENT_DATE, 'Q'), -3) AND ${df} < TRUNC(CURRENT_DATE, 'Q')`
        },
        'qtd': {
            desc: 'Quarter to date (alias for this_quarter)',
            category: 'quarterly',
            dates: (ctx) => ({ start: ctx.thisQuarterStart, end: ctx.today }),
            sql: (df) => `${df} >= TRUNC(CURRENT_DATE, 'Q')`
        },

        // === Fiscal Year-to-Date ===
        'ytd': {
            desc: 'Fiscal year-to-date (FY start to now)',
            category: 'fiscal_ytd',
            dates: (ctx) => ({ start: ctx.fyStartDate, end: ctx.today }),
            sql: (df, ctx) => `${df} >= TO_DATE('${ctx.fyStartDate}', 'YYYY-MM-DD')`
        },
        'fytd': {
            desc: 'Alias for ytd',
            category: 'fiscal_ytd',
            dates: (ctx) => ({ start: ctx.fyStartDate, end: ctx.today }),
            sql: (df, ctx) => `${df} >= TO_DATE('${ctx.fyStartDate}', 'YYYY-MM-DD')`
        },
        'ytd_closed': {
            desc: 'Fiscal YTD to last closed period (complete data only)',
            category: 'fiscal_ytd',
            dates: (ctx) => ({ start: ctx.fyStartDate, end: ctx.closedPeriodEnd }),
            sql: (df, ctx) => `${df} >= TO_DATE('${ctx.fyStartDate}', 'YYYY-MM-DD') AND ${df} <= TO_DATE('${ctx.closedPeriodEnd}', 'YYYY-MM-DD')`
        },
        'fytd_closed': {
            desc: 'Alias for ytd_closed',
            category: 'fiscal_ytd',
            dates: (ctx) => ({ start: ctx.fyStartDate, end: ctx.closedPeriodEnd }),
            sql: (df, ctx) => `${df} >= TO_DATE('${ctx.fyStartDate}', 'YYYY-MM-DD') AND ${df} <= TO_DATE('${ctx.closedPeriodEnd}', 'YYYY-MM-DD')`
        },

        // === Full Fiscal Years ===
        'this_fiscal_year': {
            desc: 'Current full fiscal year',
            category: 'fiscal_year',
            dates: (ctx) => ({ start: ctx.fyStartDate, end: ctx.fyEndDate }),
            sql: (df, ctx) => `${df} >= TO_DATE('${ctx.fyStartDate}', 'YYYY-MM-DD') AND ${df} <= TO_DATE('${ctx.fyEndDate}', 'YYYY-MM-DD')`
        },
        'last_fiscal_year': {
            desc: 'Previous full fiscal year',
            category: 'fiscal_year',
            dates: (ctx) => ({ start: ctx.lastFyStart, end: ctx.lastFyEnd }),
            sql: (df, ctx) => `${df} >= TO_DATE('${ctx.lastFyStart}', 'YYYY-MM-DD') AND ${df} <= TO_DATE('${ctx.lastFyEnd}', 'YYYY-MM-DD')`
        },
        '2_fiscal_years_ago': {
            desc: 'Two fiscal years ago (full year)',
            category: 'fiscal_year',
            dates: (ctx) => ({ start: ctx.twoFyStart, end: ctx.twoFyEnd }),
            sql: (df, ctx) => `${df} >= TO_DATE('${ctx.twoFyStart}', 'YYYY-MM-DD') AND ${df} <= TO_DATE('${ctx.twoFyEnd}', 'YYYY-MM-DD')`
        },
        '3_fiscal_years_ago': {
            desc: 'Three fiscal years ago (full year)',
            category: 'fiscal_year',
            dates: (ctx) => ({ start: ctx.threeFyStart, end: ctx.threeFyEnd }),
            sql: (df, ctx) => `${df} >= TO_DATE('${ctx.threeFyStart}', 'YYYY-MM-DD') AND ${df} <= TO_DATE('${ctx.threeFyEnd}', 'YYYY-MM-DD')`
        },

        // === YoY Comparison (CRITICAL for comparisons) ===
        'prior_year_ytd': {
            desc: 'Same point in LAST fiscal year - USE FOR YoY YTD COMPARISON',
            category: 'comparison',
            dates: (ctx) => ({ start: ctx.lastFyStart, end: ctx.priorYtdEnd }),
            sql: (df, ctx) => `${df} >= TO_DATE('${ctx.lastFyStart}', 'YYYY-MM-DD') AND ${df} <= TO_DATE('${ctx.priorYtdEnd}', 'YYYY-MM-DD')`
        },

        // === Current Fiscal Year Quarters ===
        'fiscal_q1': {
            desc: 'Q1 of current fiscal year',
            category: 'fiscal_quarter',
            dates: (ctx) => ({ start: ctx.fyQ1.start, end: ctx.fyQ1.end }),
            sql: (df, ctx) => `${df} >= TO_DATE('${ctx.fyQ1.start}', 'YYYY-MM-DD') AND ${df} <= TO_DATE('${ctx.fyQ1.end}', 'YYYY-MM-DD')`
        },
        'fiscal_q2': {
            desc: 'Q2 of current fiscal year',
            category: 'fiscal_quarter',
            dates: (ctx) => ({ start: ctx.fyQ2.start, end: ctx.fyQ2.end }),
            sql: (df, ctx) => `${df} >= TO_DATE('${ctx.fyQ2.start}', 'YYYY-MM-DD') AND ${df} <= TO_DATE('${ctx.fyQ2.end}', 'YYYY-MM-DD')`
        },
        'fiscal_q3': {
            desc: 'Q3 of current fiscal year',
            category: 'fiscal_quarter',
            dates: (ctx) => ({ start: ctx.fyQ3.start, end: ctx.fyQ3.end }),
            sql: (df, ctx) => `${df} >= TO_DATE('${ctx.fyQ3.start}', 'YYYY-MM-DD') AND ${df} <= TO_DATE('${ctx.fyQ3.end}', 'YYYY-MM-DD')`
        },
        'fiscal_q4': {
            desc: 'Q4 of current fiscal year',
            category: 'fiscal_quarter',
            dates: (ctx) => ({ start: ctx.fyQ4.start, end: ctx.fyQ4.end }),
            sql: (df, ctx) => `${df} >= TO_DATE('${ctx.fyQ4.start}', 'YYYY-MM-DD') AND ${df} <= TO_DATE('${ctx.fyQ4.end}', 'YYYY-MM-DD')`
        },

        // === Last Fiscal Year Quarters ===
        'last_fiscal_q1': {
            desc: 'Q1 of last fiscal year',
            category: 'fiscal_quarter',
            dates: (ctx) => ({ start: ctx.lastFyQ1.start, end: ctx.lastFyQ1.end }),
            sql: (df, ctx) => `${df} >= TO_DATE('${ctx.lastFyQ1.start}', 'YYYY-MM-DD') AND ${df} <= TO_DATE('${ctx.lastFyQ1.end}', 'YYYY-MM-DD')`
        },
        'last_fiscal_q2': {
            desc: 'Q2 of last fiscal year',
            category: 'fiscal_quarter',
            dates: (ctx) => ({ start: ctx.lastFyQ2.start, end: ctx.lastFyQ2.end }),
            sql: (df, ctx) => `${df} >= TO_DATE('${ctx.lastFyQ2.start}', 'YYYY-MM-DD') AND ${df} <= TO_DATE('${ctx.lastFyQ2.end}', 'YYYY-MM-DD')`
        },
        'last_fiscal_q3': {
            desc: 'Q3 of last fiscal year',
            category: 'fiscal_quarter',
            dates: (ctx) => ({ start: ctx.lastFyQ3.start, end: ctx.lastFyQ3.end }),
            sql: (df, ctx) => `${df} >= TO_DATE('${ctx.lastFyQ3.start}', 'YYYY-MM-DD') AND ${df} <= TO_DATE('${ctx.lastFyQ3.end}', 'YYYY-MM-DD')`
        },
        'last_fiscal_q4': {
            desc: 'Q4 of last fiscal year',
            category: 'fiscal_quarter',
            dates: (ctx) => ({ start: ctx.lastFyQ4.start, end: ctx.lastFyQ4.end }),
            sql: (df, ctx) => `${df} >= TO_DATE('${ctx.lastFyQ4.start}', 'YYYY-MM-DD') AND ${df} <= TO_DATE('${ctx.lastFyQ4.end}', 'YYYY-MM-DD')`
        },

        // === Rolling Periods (calendar-based) ===
        'last_7_days': {
            desc: 'Last 7 calendar days',
            category: 'rolling',
            dates: (ctx) => {
                const end = new Date();
                const start = new Date();
                start.setDate(start.getDate() - 7);
                return { start: formatDateForQuery(start), end: formatDateForQuery(end) };
            },
            sql: (df) => `${df} >= CURRENT_DATE - 7`
        },
        'last_14_days': {
            desc: 'Last 14 calendar days',
            category: 'rolling',
            dates: (ctx) => {
                const end = new Date();
                const start = new Date();
                start.setDate(start.getDate() - 14);
                return { start: formatDateForQuery(start), end: formatDateForQuery(end) };
            },
            sql: (df) => `${df} >= CURRENT_DATE - 14`
        },
        'last_30_days': {
            desc: 'Last 30 calendar days',
            category: 'rolling',
            dates: (ctx) => {
                const end = new Date();
                const start = new Date();
                start.setDate(start.getDate() - 30);
                return { start: formatDateForQuery(start), end: formatDateForQuery(end) };
            },
            sql: (df) => `${df} >= CURRENT_DATE - 30`
        },
        'last_60_days': {
            desc: 'Last 60 calendar days',
            category: 'rolling',
            dates: (ctx) => {
                const end = new Date();
                const start = new Date();
                start.setDate(start.getDate() - 60);
                return { start: formatDateForQuery(start), end: formatDateForQuery(end) };
            },
            sql: (df) => `${df} >= CURRENT_DATE - 60`
        },
        'last_90_days': {
            desc: 'Last 90 calendar days',
            category: 'rolling',
            dates: (ctx) => {
                const end = new Date();
                const start = new Date();
                start.setDate(start.getDate() - 90);
                return { start: formatDateForQuery(start), end: formatDateForQuery(end) };
            },
            sql: (df) => `${df} >= CURRENT_DATE - 90`
        },
        'last_180_days': {
            desc: 'Last 180 calendar days (6 months)',
            category: 'rolling',
            dates: (ctx) => {
                const end = new Date();
                const start = new Date();
                start.setDate(start.getDate() - 180);
                return { start: formatDateForQuery(start), end: formatDateForQuery(end) };
            },
            sql: (df) => `${df} >= CURRENT_DATE - 180`
        },
        'last_6_months': {
            desc: 'Last 6 calendar months',
            category: 'rolling',
            dates: (ctx) => {
                const end = new Date();
                const start = new Date();
                start.setMonth(start.getMonth() - 6);
                return { start: formatDateForQuery(start), end: formatDateForQuery(end) };
            },
            sql: (df) => `${df} >= ADD_MONTHS(CURRENT_DATE, -6)`
        },
        'last_365_days': {
            desc: 'Last 365 calendar days (1 year)',
            category: 'rolling',
            dates: (ctx) => {
                const end = new Date();
                const start = new Date();
                start.setDate(start.getDate() - 365);
                return { start: formatDateForQuery(start), end: formatDateForQuery(end) };
            },
            sql: (df) => `${df} >= CURRENT_DATE - 365`
        },
        'last_12_months': {
            desc: 'Last 12 calendar months',
            category: 'rolling',
            dates: (ctx) => {
                const end = new Date();
                const start = new Date();
                start.setFullYear(start.getFullYear() - 1);
                return { start: formatDateForQuery(start), end: formatDateForQuery(end) };
            },
            sql: (df) => `${df} >= ADD_MONTHS(CURRENT_DATE, -12)`
        },
        'last_2_years': {
            desc: 'Last 730 calendar days (2 years)',
            category: 'rolling',
            dates: (ctx) => {
                const end = new Date();
                const start = new Date();
                start.setDate(start.getDate() - 730);
                return { start: formatDateForQuery(start), end: formatDateForQuery(end) };
            },
            sql: (df) => `${df} >= CURRENT_DATE - 730`
        },
        'last_3_years': {
            desc: 'Last 1095 calendar days (3 years)',
            category: 'rolling',
            dates: (ctx) => {
                const end = new Date();
                const start = new Date();
                start.setDate(start.getDate() - 1095);
                return { start: formatDateForQuery(start), end: formatDateForQuery(end) };
            },
            sql: (df) => `${df} >= CURRENT_DATE - 1095`
        },

        // === Multi-Year Fiscal ===
        'last_2_fiscal_years': {
            desc: 'Last 2 fiscal years combined',
            category: 'multi_year',
            dates: (ctx) => ({ start: ctx.lastFyStart, end: ctx.today }),
            sql: (df, ctx) => `${df} >= TO_DATE('${ctx.lastFyStart}', 'YYYY-MM-DD')`
        },
        'last_3_fiscal_years': {
            desc: 'Last 3 fiscal years combined',
            category: 'multi_year',
            dates: (ctx) => ({ start: ctx.twoFyStart, end: ctx.today }),
            sql: (df, ctx) => `${df} >= TO_DATE('${ctx.twoFyStart}', 'YYYY-MM-DD')`
        },

        // === All Time ===
        'all': {
            desc: 'All available data (no date filter)',
            category: 'all',
            dates: (ctx) => ({ start: '1900-01-01', end: ctx.today }),
            sql: () => '1=1'
        },
        'all_time': {
            desc: 'All available data (alias for all)',
            category: 'all',
            dates: (ctx) => ({ start: '1900-01-01', end: ctx.today }),
            sql: () => '1=1'
        }
    };

    /**
     * Get start/end dates for a period - PRIMARY API FOR DATA MODULES
     * @param {string} period - Period key from PERIOD_DEFINITIONS
     * @param {string} [defaultPeriod='ytd'] - Fallback if period is invalid
     * @returns {Object} { start: 'YYYY-MM-DD', end: 'YYYY-MM-DD', period: string }
     */
    function getPeriodDates(period, defaultPeriod = 'ytd') {
        const ctx = buildFiscalContext();
        const def = PERIOD_DEFINITIONS[period];

        if (!def) {
            if (period && period !== 'all') {
                log.audit('getPeriodDates', 'Unknown period "' + period + '", using default "' + defaultPeriod + '"');
            }
            const fallbackDef = PERIOD_DEFINITIONS[defaultPeriod] || PERIOD_DEFINITIONS['ytd'];
            const dates = fallbackDef.dates(ctx);
            return { start: dates.start, end: dates.end, period: defaultPeriod };
        }

        const dates = def.dates(ctx);
        return { start: dates.start, end: dates.end, period: period };
    }

    /**
     * Build SQL WHERE clause for a period - FOR DIRECT SQL QUERIES
     * @param {string} period - Period key from PERIOD_DEFINITIONS
     * @param {string} [dateField='transaction.trandate'] - SQL date column
     * @returns {string} SQL WHERE clause fragment
     */
    function buildPeriodFilter(period, dateField) {
        dateField = dateField || 'transaction.trandate';
        const ctx = buildFiscalContext();
        const def = PERIOD_DEFINITIONS[period];

        if (!def) {
            if (period && period !== 'all') {
                log.audit('buildPeriodFilter', 'Unknown period "' + period + '", defaulting to all');
            }
            return '1=1';
        }

        return def.sql(dateField, ctx);
    }

    /**
     * Get list of all valid period keys - FOR TOOL SCHEMA ENUMS
     * @returns {Array<string>} Array of valid period keys
     */
    function getValidPeriods() {
        return Object.keys(PERIOD_DEFINITIONS);
    }

    /**
     * Get formatted period options for LLM prompts
     * @returns {string} Formatted string for injection into prompts
     */
    function getAvailablePeriods() {
        const lines = ['VALID PERIOD VALUES (use exact strings for "period" parameter):'];
        let lastCategory = '';

        Object.entries(PERIOD_DEFINITIONS).forEach(([key, def]) => {
            if (def.category !== lastCategory) {
                lastCategory = def.category;
            }
            lines.push(`  "${key}": ${def.desc}`);
        });

        lines.push('');
        lines.push('COMPARISON TIP: For YoY comparison, call same tool twice:');
        lines.push('  - First with period="ytd" (current year-to-date)');
        lines.push('  - Then with period="prior_year_ytd" (same point last year)');

        return lines.join('\n');
    }

    /**
     * Build period filter for accounting period table (ap.startdate)
     * Used by income statement, balance sheet, and other financial reports
     * @param {string} period - Period key from PERIOD_DEFINITIONS
     * @returns {string} SQL WHERE clause for accounting period filtering
     */
    function buildAccountingPeriodFilter(period) {
        const def = PERIOD_DEFINITIONS[period];
        if (!def) {
            if (period && period !== 'all') {
                log.audit('buildAccountingPeriodFilter', 'Unknown period "' + period + '", defaulting to all');
            }
            return '1=1';
        }

        const ctx = buildFiscalContext();
        // Accounting periods use startdate field
        return def.sql('ap.startdate', ctx);
    }

    // ==========================================
    // QUERY HELPERS
    // ==========================================

    /**
     * Run a SuiteQL query and return mapped results
     * @param {string} sql - SQL query string
     * @param {Object} [options] - Query options
     * @returns {Array} Query results
     */
    function runQuery(sql, options = {}) {
        try {
            const results = query.runSuiteQL({
                query: sql,
                params: options.params || []
            });
            
            return results.asMappedResults();
        } catch (e) {
            log.error('runQuery Error', { sql: sql.substring(0, 200), error: e.message });
            throw e;
        }
    }

    /**
     * Run a paginated SuiteQL query for large result sets
     * @param {string} sql - SQL query string
     * @param {number} [pageSize=1000] - Results per page
     * @returns {Array} All results combined
     */
    function runQueryPaginated(sql, pageSize = 1000) {
        const allResults = [];
        
        try {
            const pagedQuery = query.runSuiteQLPaged({
                query: sql,
                pageSize: pageSize
            });
            
            pagedQuery.pageRanges.forEach(function(pageRange) {
                const page = pagedQuery.fetch({ index: pageRange.index });
                allResults.push(...page.data.asMappedResults());
            });
            
            return allResults;
        } catch (e) {
            log.error('runQueryPaginated Error', { sql: sql.substring(0, 200), error: e.message });
            throw e;
        }
    }

    /**
     * Build a WHERE clause for subsidiary filtering
     * @param {number|string} subsidiaryId
     * @param {string} [tableAlias] - Table alias (e.g., 't' for 'transaction t')
     * @returns {string} SQL fragment or empty string
     */
    function buildSubsidiaryFilter(subsidiaryId, tableAlias) {
        if (!subsidiaryId || subsidiaryId === 'all') return '';
        
        const prefix = tableAlias ? tableAlias + '.' : '';
        return ` AND ${prefix}subsidiary = ${subsidiaryId}`;
    }

    /**
     * Build a date range filter for SuiteQL
     * @param {string} dateColumn - Column name
     * @param {string} startDate - Start date (YYYY-MM-DD)
     * @param {string} endDate - End date (YYYY-MM-DD)
     * @param {string} [tableAlias]
     * @returns {string} SQL fragment
     */
    function buildDateFilter(dateColumn, startDate, endDate, tableAlias) {
        const prefix = tableAlias ? tableAlias + '.' : '';
        const col = prefix + dateColumn;
        
        return ` AND ${col} >= TO_DATE('${startDate}', 'YYYY-MM-DD') AND ${col} <= TO_DATE('${endDate}', 'YYYY-MM-DD')`;
    }

    // ==========================================
    // NUMBER UTILITIES
    // ==========================================

    /**
     * Safe number parsing
     * @param {*} value
     * @param {number} [defaultValue=0]
     * @returns {number}
     */
    function toNumber(value, defaultValue = 0) {
        if (value == null) return defaultValue;
        const num = Number(value);
        return isNaN(num) ? defaultValue : num;
    }

    /**
     * Round to 2 decimal places
     * @param {number} n - Number to round
     * @returns {number}
     */
    function round2(n) {
        return Math.round((parseFloat(n) || 0) * 100) / 100;
    }

    /**
     * Safe division avoiding divide by zero
     * @param {number} n - Numerator
     * @param {number} d - Denominator
     * @returns {number}
     */
    function safeDiv(n, d) {
        return d !== 0 ? n / d : 0.0;
    }

    /**
     * Calculate percentage
     * @param {number} numerator
     * @param {number} denominator
     * @param {number} [decimals=2]
     * @returns {number}
     */
    function percentage(numerator, denominator, decimals = 2) {
        if (!denominator || denominator === 0) return 0;
        const pct = (numerator / denominator) * 100;
        return Number(pct.toFixed(decimals));
    }

    /**
     * Calculate ratio (as decimal)
     * @param {number} numerator
     * @param {number} denominator
     * @param {number} [decimals=4]
     * @returns {number}
     */
    function ratio(numerator, denominator, decimals = 4) {
        if (!denominator || denominator === 0) return 0;
        return Number((numerator / denominator).toFixed(decimals));
    }

    /**
     * Calculate variance between two values
     * @param {number} actual
     * @param {number} baseline
     * @returns {Object} { absolute, percent }
     */
    function variance(actual, baseline) {
        const absolute = toNumber(actual) - toNumber(baseline);
        const percent = baseline !== 0 ? (absolute / Math.abs(baseline)) : 0;

        return {
            absolute: absolute,
            percent: percent
        };
    }

    /**
     * Calculate the arithmetic mean of an array of values
     * @param {number[]} values - Array of numeric values
     * @returns {number} The mean, or 0 if array is empty
     */
    function calculateMean(values) {
        if (!values || !Array.isArray(values) || values.length === 0) return 0;
        return values.reduce((a, b) => a + b, 0) / values.length;
    }

    /**
     * Calculate standard deviation of an array of values
     * @param {number[]} values - Array of numeric values
     * @returns {number} The standard deviation, or 0 if array is empty/single element
     */
    function calculateStdDev(values) {
        if (!values || !Array.isArray(values) || values.length < 2) return 0;
        const mean = calculateMean(values);
        const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
        return Math.sqrt(calculateMean(squaredDiffs));
    }

    /**
     * Get today's date as an ISO string (YYYY-MM-DD)
     * Shared utility for default end dates across modules
     * @returns {string} Today's date in YYYY-MM-DD format
     */
    function getDefaultEndDate() {
        return new Date().toISOString().split('T')[0];
    }

    /**
     * Calculate the Herfindahl-Hirschman Index (HHI) for concentration analysis
     * @param {number[]} values - Array of values (e.g., revenue per customer)
     * @param {number} [total] - Optional pre-calculated total; if not provided, sum of values is used
     * @returns {number} HHI score (0-10000 scale where 10000 = complete concentration)
     */
    function calculateHerfindahlIndex(values, total) {
        if (!values || !Array.isArray(values) || values.length === 0) return 0;

        const sum = total || values.reduce((a, b) => a + b, 0);
        if (sum === 0) return 0;

        return values.reduce((hhi, value) => {
            const share = value / sum;
            return hhi + (share * share);
        }, 0) * 10000; // Scale to standard HHI range (0-10000)
    }

    /**
     * Classify concentration risk based on HHI thresholds
     * @param {number} hhi - Herfindahl-Hirschman Index value
     * @param {number} [lowThreshold=1500] - HHI below this is low concentration
     * @param {number} [highThreshold=2500] - HHI above this is high concentration
     * @returns {string} 'low', 'moderate', or 'high'
     */
    function classifyConcentrationRisk(hhi, lowThreshold, highThreshold) {
        lowThreshold = lowThreshold || 1500;
        highThreshold = highThreshold || 2500;

        if (hhi >= highThreshold) return 'high';
        if (hhi >= lowThreshold) return 'moderate';
        return 'low';
    }

    // ==========================================
    // ACCOUNT/SUBSIDIARY HELPERS
    // ==========================================

    /**
     * Get all subsidiaries (for OneWorld accounts)
     * @returns {Array} [{ id, name, isElimination, currency }]
     */
    function getSubsidiaries() {
        try {
            const sql = `
                SELECT 
                    id,
                    name,
                    iselimination,
                    currency
                FROM subsidiary
                WHERE isinactive = 'F'
                ORDER BY name
            `;
            return runQuery(sql);
        } catch (e) {
            // Not a OneWorld account or error
            log.debug('getSubsidiaries', 'Not a OneWorld account or error: ' + e.message);
            return [];
        }
    }

    /**
     * Get bank accounts
     * @param {number} [subsidiaryId] - Optional subsidiary filter
     * @returns {Array} [{ id, accountnumber, name, balance, subsidiary, currency }]
     */
    function getBankAccounts(subsidiaryId) {
        let sql = `
            SELECT 
                a.id,
                a.acctnumber AS accountnumber,
                a.accountsearchdisplayname AS name,
                a.balance,
                a.subsidiary,
                s.name AS subsidiaryname,
                a.currency
            FROM account a
            LEFT JOIN subsidiary s ON a.subsidiary = s.id
            WHERE a.accttype = 'Bank'
            AND a.isinactive = 'F'
        `;
        
        if (subsidiaryId) {
            sql += ` AND a.subsidiary = ${subsidiaryId}`;
        }
        
        sql += ` ORDER BY s.name, a.accountsearchdisplayname`;
        
        return runQuery(sql);
    }

    /**
     * Get departments
     * @param {number} [subsidiaryId] - Optional subsidiary filter
     * @returns {Array} [{ id, name }]
     */
    function getDepartments(subsidiaryId) {
        let sql = `
            SELECT 
                id,
                name
            FROM department
            WHERE isinactive = 'F'
        `;
        
        if (subsidiaryId) {
            sql += ` AND subsidiary = ${subsidiaryId}`;
        }
        
        sql += ` ORDER BY name`;
        
        return runQuery(sql);
    }

    // ==========================================
    // RUNTIME HELPERS
    // ==========================================

    /**
     * Get current user info
     * @returns {Object} { id, name, email, role, subsidiary }
     */
    function getCurrentUser() {
        const user = runtime.getCurrentUser();
        return {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            roleId: user.roleId,
            subsidiary: user.subsidiary,
            department: user.department,
            location: user.location
        };
    }

    /**
     * Check remaining governance units
     * @returns {number}
     */
    function getRemainingUsage() {
        const script = runtime.getCurrentScript();
        return script.getRemainingUsage();
    }

    /**
     * Check if running low on governance
     * @param {number} [threshold=100]
     * @returns {boolean}
     */
    function isLowOnGovernance(threshold = 100) {
        return getRemainingUsage() < threshold;
    }

    // ==========================================
    // EXPORTS
    // ==========================================

    return {
        // Date utilities
        parseDateRange: parseDateRange,
        parseDate: parseDate,
        formatDateForQuery: formatDateForQuery,
        formatDateForDisplay: formatDateForDisplay,
        calculatePresetRange: calculatePresetRange,
        getPriorYearRange: getPriorYearRange,
        getPriorPeriodRange: getPriorPeriodRange,

        // Unified Period System (Single Source of Truth)
        getPeriodDates: getPeriodDates,
        buildPeriodFilter: buildPeriodFilter,
        buildAccountingPeriodFilter: buildAccountingPeriodFilter,
        getValidPeriods: getValidPeriods,
        getAvailablePeriods: getAvailablePeriods,
        PERIOD_DEFINITIONS: PERIOD_DEFINITIONS,

        // Query helpers
        runQuery: runQuery,
        runQueryPaginated: runQueryPaginated,
        buildSubsidiaryFilter: buildSubsidiaryFilter,
        buildDateFilter: buildDateFilter,

        // Number utilities
        toNumber: toNumber,
        round2: round2,
        safeDiv: safeDiv,
        percentage: percentage,
        ratio: ratio,
        variance: variance,
        calculateMean: calculateMean,
        calculateStdDev: calculateStdDev,

        // Date utilities (consolidated)
        getDefaultEndDate: getDefaultEndDate,

        // Concentration/HHI utilities
        calculateHerfindahlIndex: calculateHerfindahlIndex,
        classifyConcentrationRisk: classifyConcentrationRisk,

        // Account/Subsidiary helpers
        getSubsidiaries: getSubsidiaries,
        getBankAccounts: getBankAccounts,
        getDepartments: getDepartments,

        // Runtime helpers
        getCurrentUser: getCurrentUser,
        getRemainingUsage: getRemainingUsage,
        isLowOnGovernance: isLowOnGovernance
    };
});
