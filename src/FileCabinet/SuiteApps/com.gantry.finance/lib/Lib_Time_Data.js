/**
 * @NApiVersion 2.1
 */
define(["N/query", "N/log", "./Lib_Core", "./Lib_Config"], function (query, log, Core, ConfigLib) {

    function getData(context) {
        try {
            // Load configuration (may be subsidiary-specific)
            const subsidiaryId = context.subsidiary || null;
            const configName = subsidiaryId ? 'time_' + subsidiaryId : 'time';
            const config = ConfigLib.getStoredConfiguration(configName.split('_')[0]); // Get base config

            let rangeStart, rangeEnd;

            // 1. Resolve Dates using unified period system
            // Priority: explicit dates > period parameter > default (last_month)
            if (context.startDate && context.endDate) {
                // Explicit dates provided
                rangeStart = new Date(context.startDate);
                rangeEnd = new Date(context.endDate);
            } else if (context.period) {
                // Use unified period system from Lib_Core
                const periodDates = Core.getPeriodDates(context.period, 'last_month');
                rangeStart = new Date(periodDates.start);
                rangeEnd = new Date(periodDates.end);
            } else {
                // Default to last_month for backward compatibility
                const periodDates = Core.getPeriodDates('last_month', 'last_month');
                rangeStart = new Date(periodDates.start);
                rangeEnd = new Date(periodDates.end);
            }

            // Calculate Prior Range (Same duration immediately preceding)
            const daysInRange = Math.ceil((rangeEnd - rangeStart) / (1000 * 60 * 60 * 24)) + 1;
            const priorEnd = new Date(rangeStart);
            priorEnd.setDate(priorEnd.getDate() - 1);
            const priorStart = new Date(priorEnd);
            priorStart.setDate(priorStart.getDate() - daysInRange + 1);

            const rangeStr = { start: Core.formatDateForQuery(rangeStart), end: Core.formatDateForQuery(rangeEnd) };
            const priorStr = { start: Core.formatDateForQuery(priorStart), end: Core.formatDateForQuery(priorEnd) };

            // 2. Fetch Data via SuiteQL (with subsidiary filter)
            const currentStats = fetchTimeStats(rangeStr.start, rangeStr.end, config, subsidiaryId);
            const priorStats = fetchTimeStats(priorStr.start, priorStr.end, config, subsidiaryId);

            // 3. Filter hidden departments and employees
            const hiddenDepts = new Set((config.hiddenDepartments || []).map(String));
            const hiddenEmps = new Set((config.hiddenEmployees || []).map(String));
            const noBillDepts = new Set((config.noBillableDepartments || []).map(String));
            
            const filteredCurrentStats = currentStats.filter(s => 
                !hiddenDepts.has(String(s.department)) && !hiddenEmps.has(String(s.employee))
            );
            const filteredPriorStats = priorStats.filter(s => 
                !hiddenDepts.has(String(s.department)) && !hiddenEmps.has(String(s.employee))
            );

            // 4. Calculate rolling history (5 prior periods)
            const history = calculateRollingHistory(rangeStart, rangeEnd, config, hiddenDepts, hiddenEmps, noBillDepts, subsidiaryId);

            // 5. Build Payload
            return {
                meta: { 
                    range: { start: rangeStr.start, end: rangeStr.end, days: daysInRange }, 
                    hasData: true,
                    subsidiary: subsidiaryId,
                    config: {
                        targetBillablePercent: config.targetBillablePercent,
                        nonBillableCostSpikeThreshold: config.nonBillableCostSpikeThreshold,
                        minimumHoursForAnalysis: config.minimumHoursForAnalysis,
                        noBillableDepartments: config.noBillableDepartments || []
                    }
                },
                company: buildTimeCompany(filteredCurrentStats, filteredPriorStats, daysInRange, config, noBillDepts),
                departments: buildTimeGroup(filteredCurrentStats, filteredPriorStats, 'department', config, noBillDepts),
                items: buildTimeGroup(filteredCurrentStats, filteredPriorStats, 'item', config, noBillDepts),
                employees: buildTimeGroup(filteredCurrentStats, filteredPriorStats, 'employee', config, noBillDepts),
                history: history
            };

        } catch (e) {
            log.error('Time Data Error', e);
            return { error: e.message };
        }
    }

    /**
     * Calculate rolling history - 5 prior periods using same methodology
     */
    function calculateRollingHistory(rangeStart, rangeEnd, config, hiddenDepts, hiddenEmps, noBillDepts, subsidiaryId) {
        const periodMonths = (rangeEnd.getFullYear() - rangeStart.getFullYear()) * 12 + 
                            (rangeEnd.getMonth() - rangeStart.getMonth()) + 1;

        const periods = [];
        const seenLabels = new Set();
        
        for (let i = 1; i <= 5; i++) {
            // FIXED: Use Date object setMonth() for robust month arithmetic
            // This automatically handles year rollovers correctly
            
            // End date: go back i*periodMonths from rangeEnd, get last day of that month
            const pEnd = new Date(rangeEnd.getFullYear(), rangeEnd.getMonth() - (i * periodMonths) + 1, 0);
            
            // Start date: first day of the month that is (periodMonths - 1) months before pEnd
            const pStart = new Date(pEnd.getFullYear(), pEnd.getMonth() - periodMonths + 1, 1);
            
            const pStartStr = Core.formatDateForQuery(pStart);
            const pEndStr = Core.formatDateForQuery(pEnd);
            
            // Create unique label
            const label = pEnd.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
            
            // Skip if we've already seen this label (deduplication)
            if (seenLabels.has(label)) {
                continue;
            }
            seenLabels.add(label);
            
            // Fetch stats for this period (with subsidiary filter)
            const stats = fetchTimeStats(pStartStr, pEndStr, config, subsidiaryId);
            const filtered = stats.filter(s => 
                !hiddenDepts.has(String(s.department)) && !hiddenEmps.has(String(s.employee))
            );
            
            // Calculate company total (excluding noBillDepts)
            let totalHours = 0, billableHours = 0;
            filtered.forEach(r => {
                if (!noBillDepts.has(String(r.department))) {
                    totalHours += parseFloat(r.total_hours || 0);
                    billableHours += parseFloat(r.billable_hours || 0);
                }
            });
            const companyPct = totalHours > 0 ? (billableHours / totalHours) * 100 : 0;
            
            // Calculate per-department (all depts, including noBill for display)
            const deptData = {};
            const deptGroups = {};
            filtered.forEach(r => {
                const deptId = r.department || '0';
                if (!deptGroups[deptId]) {
                    deptGroups[deptId] = { hours: 0, billableHours: 0 };
                }
                deptGroups[deptId].hours += parseFloat(r.total_hours || 0);
                deptGroups[deptId].billableHours += parseFloat(r.billable_hours || 0);
            });
            
            Object.keys(deptGroups).forEach(deptId => {
                const d = deptGroups[deptId];
                deptData[deptId] = {
                    percentBilled: d.hours > 0 ? (d.billableHours / d.hours) * 100 : 0,
                    noBillable: noBillDepts.has(String(deptId))
                };
            });
            
            periods.push({
                index: i,
                start: pStartStr,
                end: pEndStr,
                label: label,
                companyPct: companyPct,
                deptData: deptData
            });
        }
        
        return {
            periodMonths: periodMonths,
            periods: periods
        };
    }

    /**
     * Fetch time stats - supports configurable labor cost field and subsidiary filtering
     */
    function fetchTimeStats(start, end, config, subsidiaryId) {
        // FIXED: Sanitize laborCostField to prevent SQL injection - only allow alphanumeric and underscore
        const rawLaborCostField = config.laborCostField || 'laborcost';
        const laborCostField = rawLaborCostField.replace(/[^a-zA-Z0-9_]/g, '');
        if (!laborCostField) {
            log.error('Invalid laborCostField', 'laborCostField was empty after sanitization');
            return [];
        }

        // FIXED: Validate subsidiaryId is numeric to prevent SQL injection
        const sanitizedSubsidiaryId = subsidiaryId ? String(subsidiaryId).replace(/[^0-9]/g, '') : null;
        const subsidiaryFilter = sanitizedSubsidiaryId ? ` AND e.subsidiary = ${sanitizedSubsidiaryId}` : '';

        // Build employee type exclusion filter
        const excludeEmpTypes = (config.excludeEmployeeTypes || []).map(t => String(t).replace(/[^0-9]/g, '')).filter(t => t);
        const empTypeFilter = excludeEmpTypes.length > 0
            ? ` AND (e.employeetype IS NULL OR e.employeetype NOT IN (${excludeEmpTypes.join(',')}))`
            : '';

        const sql = `
            SELECT
                t.employee,
                BUILTIN.DF(t.employee) as employee_name,
                e.title as employee_title,
                t.department,
                BUILTIN.DF(t.department) as department_name,
                t.item,
                BUILTIN.DF(t.item) as item_name,
                SUM(t.hours) as total_hours,
                SUM(CASE WHEN t.customer IS NOT NULL THEN t.hours ELSE 0 END) as billable_hours,
                SUM(CASE WHEN t.customer IS NULL THEN t.hours * NVL(e.${laborCostField}, 0) ELSE 0 END) as non_billable_cost
            FROM timebill t
            LEFT JOIN employee e ON t.employee = e.id
            WHERE t.trandate >= TO_DATE('${start}', 'YYYY-MM-DD')
              AND t.trandate <= TO_DATE('${end}', 'YYYY-MM-DD')
              ${subsidiaryFilter}
              ${empTypeFilter}
            GROUP BY t.employee, BUILTIN.DF(t.employee), e.title, t.department, BUILTIN.DF(t.department), t.item, BUILTIN.DF(t.item)
        `;
        return Core.runQuery(sql);
    }

    function buildTimeCompany(curr, prior, days, config, noBillDepts) {
        // For company calculation, exclude departments without billable expectation
        const billableCurr = curr.filter(r => !noBillDepts.has(String(r.department)));
        const billablePrior = prior.filter(r => !noBillDepts.has(String(r.department)));
        
        const sum = (rows) => rows.reduce((acc, r) => ({
            hours: acc.hours + parseFloat(r.total_hours||0),
            billableHours: acc.billableHours + parseFloat(r.billable_hours||0),
            nonBillableCost: acc.nonBillableCost + parseFloat(r.non_billable_cost||0)
        }), { hours: 0, billableHours: 0, nonBillableCost: 0 });

        // Company stats use only billable-expected departments
        const c = sum(billableCurr);
        const p = sum(billablePrior);
        
        // Total cost includes ALL departments (for visibility)
        const cTotal = sum(curr);

        const calc = (stats) => ({
            ...stats,
            percentBilled: stats.hours > 0 ? (stats.billableHours / stats.hours) * 100 : 0,
            nonBillableHours: stats.hours - stats.billableHours,
            nonBillableCostPerDay: days > 0 ? stats.nonBillableCost / days : 0,
            nonBillableCostPerHour: (stats.hours - stats.billableHours) > 0 ? stats.nonBillableCost / (stats.hours - stats.billableHours) : 0
        });

        const cCalc = calc(c);
        const pCalc = calc(p);
        
        // Add total non-billable cost (all depts) for visibility
        cCalc.totalNonBillableCost = cTotal.nonBillableCost;
        
        // Calculate alerts based on configurable thresholds
        const targetBillable = config.targetBillablePercent || 70;
        const costSpikeThreshold = config.nonBillableCostSpikeThreshold || 1000;
        
        const alerts = [];
        if (cCalc.percentBilled < targetBillable) {
            alerts.push({
                type: 'warning',
                message: `Billable % below ${targetBillable}% target`,
                value: cCalc.percentBilled
            });
        }
        if (cCalc.nonBillableCost - pCalc.nonBillableCost > costSpikeThreshold) {
            alerts.push({
                type: 'danger',
                message: `Non-billable cost spiked by $${Math.round(cCalc.nonBillableCost - pCalc.nonBillableCost)}`,
                value: cCalc.nonBillableCost - pCalc.nonBillableCost
            });
        }

        return {
            range: cCalc,
            priorRange: pCalc,
            deltas: {
                percentBilledDelta: cCalc.percentBilled - pCalc.percentBilled,
                nonBillableCostDelta: cCalc.nonBillableCost - pCalc.nonBillableCost
            },
            alerts: alerts,
            thresholds: {
                targetBillablePercent: targetBillable,
                nonBillableCostSpikeThreshold: costSpikeThreshold
            }
        };
    }

    function buildTimeGroup(curr, prior, groupKey, config, noBillDepts) {
        const minimumHours = config.minimumHoursForAnalysis || 10;
        
        // Build a map of department IDs to names
        const deptNameMap = {};
        curr.forEach(r => {
            if (r.department && r.department_name) {
                deptNameMap[r.department] = r.department_name;
            }
        });
        
        // Group rows by key (department, item, or employee)
        const groupBy = (rows) => {
            const groups = {};
            rows.forEach(r => {
                const id = r[groupKey] || '0';
                if (!groups[id]) {
                    groups[id] = { 
                        id: id,
                        name: r[groupKey + '_name'] || 'Unknown',
                        title: groupKey === 'employee' ? r.employee_title : null,
                        departmentId: r.department,
                        departmentName: deptNameMap[r.department] || 'Unknown Department',
                        departmentHours: {}, // Track hours per department
                        hours: 0, billableHours: 0, nonBillableCost: 0
                    };
                }
                groups[id].hours += parseFloat(r.total_hours||0);
                groups[id].billableHours += parseFloat(r.billable_hours||0);
                groups[id].nonBillableCost += parseFloat(r.non_billable_cost||0);
                
                // Track department hours for employee/item grouping (to find primary department)
                if ((groupKey === 'employee' || groupKey === 'item') && r.department) {
                    const deptId = r.department;
                    groups[id].departmentHours[deptId] = (groups[id].departmentHours[deptId] || 0) + parseFloat(r.total_hours||0);
                }
            });
            
            // For employee/item grouping, set primary department based on most hours
            if (groupKey === 'employee' || groupKey === 'item') {
                Object.values(groups).forEach(g => {
                    let maxHours = 0;
                    let primaryDeptId = g.departmentId;
                    Object.entries(g.departmentHours || {}).forEach(([deptId, hours]) => {
                        if (hours > maxHours) {
                            maxHours = hours;
                            primaryDeptId = deptId;
                        }
                    });
                    g.departmentId = primaryDeptId;
                    g.departmentName = deptNameMap[primaryDeptId] || 'Unknown Department';
                    delete g.departmentHours; // Clean up
                });
            }
            
            return groups;
        };

        const cGroups = groupBy(curr);
        const pGroups = groupBy(prior);
        
        const results = [];
        Object.keys(cGroups).forEach(id => {
            const c = cGroups[id];
            const p = pGroups[id] || { hours: 0, billableHours: 0, nonBillableCost: 0 };
            
            const calc = (stats) => ({
                ...stats,
                percentBilled: stats.hours > 0 ? (stats.billableHours / stats.hours) * 100 : 0,
                nonBillableHours: stats.hours - stats.billableHours
            });

            const cCalc = calc(c);
            const pCalc = calc(p);

            const entry = {
                range: cCalc,
                priorRange: pCalc,
                deltas: {
                    percentBilledDelta: cCalc.percentBilled - pCalc.percentBilled,
                    nonBillableCostDelta: cCalc.nonBillableCost - pCalc.nonBillableCost
                },
                meetsMinimumHours: cCalc.hours >= minimumHours
            };
            
            // Add noBillable flag for departments
            if (groupKey === 'department') {
                entry.noBillable = noBillDepts.has(String(id));
            }
            
            entry[groupKey] = { netsuiteId: id, name: c.name, title: c.title, departmentId: c.departmentId, departmentName: c.departmentName };
            results.push(entry);
        });

        // Sort by non-billable cost (desc)
        return results.sort((a,b) => b.range.nonBillableCost - a.range.nonBillableCost);
    }

    /**
     * Handle sub-action requests (employee_entries, item_entries)
     */
    function handleRequest(data) {
        const subAction = data.subAction;

        // Load config for employee type filtering
        const config = ConfigLib.getStoredConfiguration('time');

        if (subAction === 'employee_entries') {
            return getEmployeeTimeEntries(data, config);
        }

        if (subAction === 'item_entries') {
            return getItemTimeEntries(data, config);
        }

        return { status: 'error', message: 'Unknown subAction: ' + subAction };
    }

    /**
     * Get individual time entries for an employee
     */
    function getEmployeeTimeEntries(data, config) {
        const employeeId = data.employeeId;
        const startDate = data.startDate;
        const endDate = data.endDate;
        const subsidiaryId = data.subsidiary || null;

        if (!employeeId) {
            return { status: 'error', message: 'employeeId is required' };
        }

        // FIXED: Sanitize all inputs to prevent SQL injection
        const sanitizedEmployeeId = String(employeeId).replace(/[^0-9]/g, '');
        const sanitizedSubsidiaryId = subsidiaryId ? String(subsidiaryId).replace(/[^0-9]/g, '') : null;
        const sanitizedStartDate = String(startDate || '').replace(/[^0-9\-]/g, '');
        const sanitizedEndDate = String(endDate || '').replace(/[^0-9\-]/g, '');

        if (!sanitizedEmployeeId) {
            return { status: 'error', message: 'Invalid employeeId' };
        }

        let subsidiaryFilter = '';
        if (sanitizedSubsidiaryId) {
            subsidiaryFilter = `AND e.subsidiary = ${sanitizedSubsidiaryId}`;
        }

        // Build employee type exclusion filter
        const cfg = config || {};
        const excludeEmpTypes = (cfg.excludeEmployeeTypes || []).map(t => String(t).replace(/[^0-9]/g, '')).filter(t => t);
        const empTypeFilter = excludeEmpTypes.length > 0
            ? ` AND (e.employeetype IS NULL OR e.employeetype NOT IN (${excludeEmpTypes.join(',')}))`
            : '';

        const sql = `
            SELECT
                t.id as entry_id,
                TO_CHAR(t.trandate, 'YYYY-MM-DD') as date,
                t.hours,
                CASE WHEN t.customer IS NOT NULL THEN t.hours ELSE 0 END as billable_hours,
                t.item,
                BUILTIN.DF(t.item) as item_name,
                t.customer,
                BUILTIN.DF(t.customer) as customer_name,
                t.memo
            FROM timebill t
            LEFT JOIN employee e ON t.employee = e.id
            WHERE t.employee = ${sanitizedEmployeeId}
              AND t.trandate >= TO_DATE('${sanitizedStartDate}', 'YYYY-MM-DD')
              AND t.trandate <= TO_DATE('${sanitizedEndDate}', 'YYYY-MM-DD')
              ${subsidiaryFilter}
              ${empTypeFilter}
            ORDER BY t.trandate DESC
        `;

        try {
            const results = Core.runQuery(sql);

            const entries = results.map(r => ({
                entryId: r.entry_id,
                date: r.date,
                hours: parseFloat(r.hours) || 0,
                billableHours: parseFloat(r.billable_hours) || 0,
                itemId: r.item,
                itemName: r.item_name || 'Unknown',
                customerId: r.customer,
                customerName: r.customer_name || '',
                memo: r.memo || ''
            }));

            return { status: 'success', entries: entries };
        } catch (e) {
            log.error('Employee Entries Error', e);
            return { status: 'error', message: e.message };
        }
    }

    /**
     * Get individual time entries for a service item
     */
    function getItemTimeEntries(data, config) {
        const itemId = data.itemId;
        const startDate = data.startDate;
        const endDate = data.endDate;
        const subsidiaryId = data.subsidiary || null;

        if (!itemId) {
            return { status: 'error', message: 'itemId is required' };
        }

        // FIXED: Sanitize all inputs to prevent SQL injection
        const sanitizedItemId = String(itemId).replace(/[^0-9]/g, '');
        const sanitizedSubsidiaryId = subsidiaryId ? String(subsidiaryId).replace(/[^0-9]/g, '') : null;
        const sanitizedStartDate = String(startDate || '').replace(/[^0-9\-]/g, '');
        const sanitizedEndDate = String(endDate || '').replace(/[^0-9\-]/g, '');

        if (!sanitizedItemId) {
            return { status: 'error', message: 'Invalid itemId' };
        }

        let subsidiaryFilter = '';
        if (sanitizedSubsidiaryId) {
            subsidiaryFilter = `AND e.subsidiary = ${sanitizedSubsidiaryId}`;
        }

        // Build employee type exclusion filter
        const cfg = config || {};
        const excludeEmpTypes = (cfg.excludeEmployeeTypes || []).map(t => String(t).replace(/[^0-9]/g, '')).filter(t => t);
        const empTypeFilter = excludeEmpTypes.length > 0
            ? ` AND (e.employeetype IS NULL OR e.employeetype NOT IN (${excludeEmpTypes.join(',')}))`
            : '';

        const sql = `
            SELECT
                t.id as entry_id,
                TO_CHAR(t.trandate, 'YYYY-MM-DD') as date,
                t.hours,
                CASE WHEN t.customer IS NOT NULL THEN t.hours ELSE 0 END as billable_hours,
                t.employee,
                BUILTIN.DF(t.employee) as employee_name,
                t.customer,
                BUILTIN.DF(t.customer) as customer_name,
                t.memo
            FROM timebill t
            LEFT JOIN employee e ON t.employee = e.id
            WHERE t.item = ${sanitizedItemId}
              AND t.trandate >= TO_DATE('${sanitizedStartDate}', 'YYYY-MM-DD')
              AND t.trandate <= TO_DATE('${sanitizedEndDate}', 'YYYY-MM-DD')
              ${subsidiaryFilter}
              ${empTypeFilter}
            ORDER BY t.trandate DESC
        `;

        try {
            const results = Core.runQuery(sql);

            const entries = results.map(r => ({
                entryId: r.entry_id,
                date: r.date,
                hours: parseFloat(r.hours) || 0,
                billableHours: parseFloat(r.billable_hours) || 0,
                employeeId: r.employee,
                employeeName: r.employee_name || 'Unknown',
                customerId: r.customer,
                customerName: r.customer_name || '',
                memo: r.memo || ''
            }));

            return { status: 'success', entries: entries };
        } catch (e) {
            log.error('Item Entries Error', e);
            return { status: 'error', message: e.message };
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // SCORE-ONLY FUNCTION - Lightweight score computation for dashboard overview
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Get time utilization score only - minimal queries for fast app load
     * Score is billable % converted to 0-100 scale (target typically 70%)
     * @returns {Object} { score: 0-100, grade: 'A'-'F', label: string, trend: string }
     */
    function getScoreOnly() {
        try {
            // Load configuration (matching getData logic)
            var config = ConfigLib.getStoredConfiguration('time') || {};

            // Get target billable percentage from config (default 70%)
            var targetPct = config.targetBillablePercent || 70;

            // Get last month's time data matching getData() logic
            var today = new Date();
            var endDate = new Date(today.getFullYear(), today.getMonth(), 0);
            var startDate = new Date(endDate.getFullYear(), endDate.getMonth(), 1);
            var start = Core.formatDateForQuery(startDate);
            var end = Core.formatDateForQuery(endDate);

            var totalHours = 0, billableHours = 0, nonBillableCost = 0, employeeCount = 0;

            // Get laborCostField from config (matching fetchTimeStats)
            var rawLaborCostField = config.laborCostField || 'laborcost';
            var laborCostField = rawLaborCostField.replace(/[^a-zA-Z0-9_]/g, '') || 'laborcost';

            // Build employee type exclusion filter (matching fetchTimeStats)
            var excludeEmpTypes = (config.excludeEmployeeTypes || []).map(function(t) { return String(t).replace(/[^0-9]/g, ''); }).filter(function(t) { return t; });
            var empTypeFilter = excludeEmpTypes.length > 0
                ? " AND (e.employeetype IS NULL OR e.employeetype NOT IN (" + excludeEmpTypes.join(',') + "))"
                : '';

            // Fetch aggregated time stats matching fetchTimeStats() query pattern
            try {
                // Simplified aggregate query - no GROUP BY needed for totals
                var sql = "SELECT " +
                    "SUM(t.hours) as total_hours, " +
                    "SUM(CASE WHEN t.customer IS NOT NULL THEN t.hours ELSE 0 END) as billable_hours, " +
                    "COUNT(DISTINCT t.employee) as employee_count, " +
                    "SUM(CASE WHEN t.customer IS NULL THEN NVL(t.hours * e." + laborCostField + ", 0) ELSE 0 END) as non_billable_cost " +
                    "FROM timebill t " +
                    "LEFT JOIN employee e ON t.employee = e.id " +
                    "WHERE t.trandate >= TO_DATE('" + start + "', 'YYYY-MM-DD') " +
                    "AND t.trandate <= TO_DATE('" + end + "', 'YYYY-MM-DD')" +
                    empTypeFilter;
                var result = Core.runQuery(sql);
                if (result && result.length > 0) {
                    totalHours = parseFloat(result[0].total_hours) || 0;
                    billableHours = parseFloat(result[0].billable_hours) || 0;
                    employeeCount = parseInt(result[0].employee_count) || 1;
                    nonBillableCost = parseFloat(result[0].non_billable_cost) || 0;
                }
            } catch (e) {
                log.debug('Time Query Error', e.message);
            }

            // Calculate billable percentage
            var billablePct = totalHours > 0 ? (billableHours / totalHours) * 100 : 0;

            // Efficiency score formula matching Dashboard.Time.js buildInsights()
            // 50 points from billable %, 50 points from cost efficiency
            // Cost efficiency: Full 50 points if cost per employee < $5000/period
            // Deduct 1 point per $200 above $5000 threshold
            var COST_EFFICIENCY_THRESHOLD = 5000;
            var COST_PENALTY_DIVISOR = 200;
            var costPerEmployee = employeeCount > 0 ? nonBillableCost / employeeCount : 0;

            var billableScore = (billablePct / targetPct) * 50;
            var costScore = employeeCount > 0
                ? (costPerEmployee < COST_EFFICIENCY_THRESHOLD
                    ? 50
                    : Math.max(0, 50 - (costPerEmployee - COST_EFFICIENCY_THRESHOLD) / COST_PENALTY_DIVISOR))
                : 25; // Default 25 if no employees (matches dashboard logic)

            var score = Math.min(100, Math.round(billableScore + costScore));

            var grade = 'A';
            var label = 'Excellent';
            if (score < 50) { grade = 'F'; label = 'Critical'; }
            else if (score < 60) { grade = 'D'; label = 'Poor'; }
            else if (score < 70) { grade = 'C'; label = 'Fair'; }
            else if (score < 80) { grade = 'B'; label = 'Good'; }
            else if (score < 90) { grade = 'A'; label = 'Very Good'; }
            else { grade = 'A+'; label = 'Excellent'; }

            var trend = 'stable';
            if (billablePct < targetPct * 0.8) trend = 'down';
            else if (billablePct > targetPct * 1.1) trend = 'up';

            return {
                score: score,
                grade: grade,
                label: label,
                trend: trend,
                details: {
                    totalHours: Core.round2(totalHours),
                    billableHours: Core.round2(billableHours),
                    billablePct: Core.round2(billablePct),
                    targetPct: targetPct,
                    employeeCount: employeeCount,
                    costPerEmployee: Core.round2(costPerEmployee)
                }
            };
        } catch (e) {
            log.error('Time getScoreOnly Error', e.message);
            return { score: null, grade: null, label: 'Unavailable', trend: 'stable', status: 'error', error: e.message };
        }
    }

    return { getData, handleRequest, getScoreOnly };
});
