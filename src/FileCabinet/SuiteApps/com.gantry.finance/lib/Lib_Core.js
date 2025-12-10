/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @module Lib_Core
 * @description Core utilities and shared functions for Gantry backend modules.
 *              Provides date handling, query helpers, and common operations.
 */
define(['N/query', 'N/search', 'N/runtime', 'N/format', 'N/log'], 
function(query, search, runtime, format, log) {
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
        
        // Query helpers
        runQuery: runQuery,
        runQueryPaginated: runQueryPaginated,
        buildSubsidiaryFilter: buildSubsidiaryFilter,
        buildDateFilter: buildDateFilter,
        
        // Number utilities
        toNumber: toNumber,
        percentage: percentage,
        ratio: ratio,
        variance: variance,
        
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
