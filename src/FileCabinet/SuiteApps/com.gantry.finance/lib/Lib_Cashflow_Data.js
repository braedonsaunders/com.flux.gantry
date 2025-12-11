/**
 * @NApiVersion 2.1
 */
define(["N/search", "N/query", "N/format", "N/log", "./Lib_Core", "./Lib_Config", "./advisor/Lib_Advisor_Utils"], function (
  search,
  query,
  format,
  log,
  Core,
  ConfigLib,
  Utils
) {

  // ═══════════════════════════════════════════════════════════════════════════
  // DEBUG LOGGING HELPERS
  // ═══════════════════════════════════════════════════════════════════════════
  
  // Cache debug mode to avoid repeated config lookups
  let _debugModeCache = null;
  let _debugModeCacheTime = 0;
  const DEBUG_CACHE_TTL = 60000; // 1 minute cache
  
  function isDebugMode() {
      const now = Date.now();
      if (_debugModeCache === null || (now - _debugModeCacheTime) > DEBUG_CACHE_TTL) {
          _debugModeCache = Utils.isDebugMode();
          _debugModeCacheTime = now;
      }
      return _debugModeCache;
  }
  
  // Conditional logging - only logs if debug mode is enabled
  function debugLog(title, details) {
      if (isDebugMode()) {
          log.debug(title, details);
      }
  }
  
  function auditLog(title, details) {
      if (isDebugMode()) {
          log.audit(title, details);
      }
  }

  function getData(context) {
    const startTime = Date.now();
    const timings = {}; // Track timing for each operation
    let t0;
    
    // 1. Config Setup
    t0 = Date.now();
    const storedConfig = ConfigLib.getStoredConfiguration('cashflow');
    const requestConfig = {
      horizonWeeks: parseInt(context.horizonWeeks) || 8,
      bankAccountIds: context.bankAccountIds
    };
    
    // Merge Configs
    const config = {
        ...storedConfig,
        horizonWeeks: requestConfig.horizonWeeks,
        // Allow runtime override of bank IDs if provided, else use stored
        bankAccountIds: requestConfig.bankAccountIds || storedConfig.bankAccountIds
    };

    // Extract prediction settings with defaults
    const predictionSettings = config.predictionSettings || {};
    const volatilityThresholds = predictionSettings.volatilityThresholds || { stable: 5, volatile: 15 };
    const overduePushDays = predictionSettings.overduePushDays || { light: 7, medium: 14, heavy: 28 };
    const paymentHistoryDays = predictionSettings.paymentHistoryDays || 365;
    const defaultDaysToPay = predictionSettings.defaultDaysToPay || 45;

    const timeline = calculateTimeline(config.horizonWeeks);
    timings.configSetup = Date.now() - t0;

    // 2. Advanced Stats (Mean/StdDev) - SINGLE combined query for both AR and AP
    t0 = Date.now();
    const combinedStats = computeCombinedStats(paymentHistoryDays, defaultDaysToPay);
    const arStats = combinedStats.ar;
    const apStats = combinedStats.ap;
    timings.combinedStats = Date.now() - t0;

    // 3. Core Forecasts - pass configurable settings
    t0 = Date.now();
    const arData = buildARForecast(timeline, arStats, volatilityThresholds, overduePushDays);
    timings.arForecast = Date.now() - t0;
    
    t0 = Date.now();
    const apData = buildAPForecast(timeline, apStats, config.apFilters || {}, overduePushDays);
    timings.apForecast = Date.now() - t0;

    // 4. Bank Balance
    t0 = Date.now();
    const bank = computeBankBalance(config.bankAccountIds);
    timings.bankBalance = Date.now() - t0;

    // 5. Dynamic Categories
    t0 = Date.now();
    const categoryResults = {};
    let dynamicInflows = {};
    let dynamicOutflows = {};
    const categoryTimings = {};
    const categoryErrors = [];

    if (config.categories && Array.isArray(config.categories)) {
      config.categories.forEach((catConfig) => {
        try {
          const catStart = Date.now();
          const result = processCategory(
            catConfig,
            timeline,
            timeline.asOfDate,
            {
              ar: arData.weeklyMap,
              ap: apData.weeklyMap,
              cashStart: bank.balance,
            }
          );
          categoryTimings[catConfig.id] = Date.now() - catStart;
          categoryResults[catConfig.id] = result;

          const targetMap = catConfig.type === "inflow" ? dynamicInflows : dynamicOutflows;
          Object.keys(result.weeklyAmounts).forEach((weekKey) => {
            targetMap[weekKey] = (targetMap[weekKey] || 0) + result.weeklyAmounts[weekKey];
          });
        } catch (e) {
          log.error(`Error processing category ${catConfig.id}`, e);
          categoryErrors.push({
            categoryId: catConfig.id,
            categoryName: catConfig.name || catConfig.id,
            error: e.message || String(e)
          });
        }
      });
    }
    timings.categories = Date.now() - t0;
    timings.categoryDetails = categoryTimings;

    // 6. Timeline Assembly
    t0 = Date.now();
    const weeklyData = buildFinalTimeline(
      timeline,
      bank.balance,
      arData.weeklyMap,
      apData.summary.bills,
      dynamicInflows,
      dynamicOutflows,
      config.apFilters
    );
    timings.timelineAssembly = Date.now() - t0;

    // Update AP Bills with the scheduled version
    apData.summary.bills = weeklyData.scheduledBills;

    // Calculate Cash Runway
    const runway = calculateRunway(bank.balance, weeklyData.weeks);

    // Generate sparkline data from weekly cash positions
    const sparklineData = {
        labels: weeklyData.weeks.map(w => w.weekLabel || w.weekStart),
        endingCash: weeklyData.weeks.map(w => w.endingCash),
        inflows: weeklyData.weeks.map(w => w.inflows?.total ?? 0),
        outflows: weeklyData.weeks.map(w => Math.abs(w.outflows?.total ?? 0))
    };

    // Calculate total time and prepare diagnostics
    timings.total = Date.now() - startTime;
    debugLog('getData', 'Completed in ' + timings.total + 'ms');
    
    // Sort timings by duration for easy identification of slow operations
    const sortedTimings = Object.entries(timings)
        .filter(([k]) => k !== 'total' && k !== 'categoryDetails')
        .sort((a, b) => b[1] - a[1])
        .reduce((obj, [k, v]) => { obj[k] = v; return obj; }, {});
    sortedTimings.total = timings.total;
    
    // Log diagnostics
    debugLog('getData diagnostics', {
        totalMs: timings.total,
        slowest: Object.keys(sortedTimings).slice(0, 3).join(', ')
    });

    const result = {
      meta: {
        asOfDate: Core.formatDateForQuery(timeline.asOfDate),
        rangeStart: Core.formatDateForQuery(timeline.start),
        rangeEnd: Core.formatDateForQuery(timeline.end),
        range: { days: timeline.days },
        horizonWeeks: config.horizonWeeks,
        activeConfig: config,
        categoryErrors: categoryErrors.length > 0 ? categoryErrors : null,
      },
      company: {
        cash: weeklyData.summary,
        weeklyCash: weeklyData.weeks,
        // Strip invoices/bills arrays from summary - they're lazy-loaded via flyout
        ar: {
          outstandingTotal: arData.summary.outstandingTotal,
          totalOutstanding: arData.summary.totalOutstanding,
          avgDaysToPay: arData.summary.avgDaysToPay,
          avgDaysUsed: arData.summary.avgDaysUsed,
          pctCurrent: arData.summary.pctCurrent,
          buckets: arData.summary.buckets
          // invoices array REMOVED - loaded on demand via getWeekTransactions
        },
        ap: {
          outstandingTotal: apData.summary.outstandingTotal,
          totalOutstanding: apData.summary.totalOutstanding,
          avgDaysToPay: apData.summary.avgDaysToPay,
          avgDaysUsed: apData.summary.avgDaysUsed,
          pctCurrent: apData.summary.pctCurrent,
          buckets: apData.summary.buckets
          // bills array REMOVED - loaded on demand via getWeekTransactions
        },
        dynamicCategories: categoryResults
      },
      runway: runway,
      sparklineData: sparklineData
    };
    
    // Include diagnostics only in debug mode
    if (isDebugMode()) {
      result.diagnostics = {
        timings: sortedTimings,
        slowestOperations: Object.entries(sortedTimings)
            .filter(([k]) => k !== 'total')
            .slice(0, 5)
            .map(([name, ms]) => ({ name, ms, percent: Math.round(ms / sortedTimings.total * 100) })),
        categoryTimings: timings.categoryDetails,
        counts: {
            categories: (config.categories || []).length,
            arInvoices: (arData.summary.invoices || []).length,
            apBills: (apData.summary.bills || []).length,
            weeks: weeklyData.weeks.length
        }
      };
    }
    
    return result;
  }

  /**
   * Calculate cash runway based on current balance and weekly projections
   */
  function calculateRunway(currentBalance, weeklyData) {
    if (!weeklyData || weeklyData.length === 0) {
      return {
        weeksRunway: null,
        avgWeeklyBurn: 0,
        currentCash: currentBalance || 0,
        status: 'unknown',
        criticalWeeks: []
      };
    }

    // Calculate average weekly outflows (burn rate)
    // Weekly data structure: { inflows: { total }, outflows: { total }, endingCash, weekStart, weekEnd }
    let totalOutflows = 0;
    let totalInflows = 0;
    const criticalWeeks = [];
    
    weeklyData.forEach((week, idx) => {
      // Handle both nested (inflows.total) and flat (totalInflow) structures
      const weekInflow = week.inflows?.total ?? week.totalInflow ?? 0;
      const weekOutflow = week.outflows?.total ?? week.totalOutflow ?? 0;
      
      totalOutflows += Math.abs(weekOutflow);
      totalInflows += weekInflow;
      
      // Track weeks with negative ending cash
      if (week.endingCash < 0) {
        criticalWeeks.push({
          weekIndex: idx + 1,
          weekLabel: week.weekLabel || week.weekStart || week.weekEnd,
          endingCash: week.endingCash
        });
      }
    });

    const avgWeeklyBurn = totalOutflows / weeklyData.length;
    const avgWeeklyInflow = totalInflows / weeklyData.length;
    const netWeeklyChange = avgWeeklyInflow - avgWeeklyBurn;
    
    // Calculate weeks of runway based on net weekly change
    let weeksRunway;
    if (currentBalance <= 0) {
      // Already negative - critical
      weeksRunway = 0;
    } else if (netWeeklyChange >= 0) {
      // Positive or neutral cash flow - sustainable
      weeksRunway = 999;
    } else if (avgWeeklyBurn === 0) {
      weeksRunway = 999;
    } else {
      // How many weeks until cash runs out based on net burn
      weeksRunway = currentBalance / Math.abs(netWeeklyChange);
    }

    // Determine status
    let status;
    if (weeksRunway >= 999) {
      status = 'healthy';
    } else if (weeksRunway > 12) {
      status = 'good';
    } else if (weeksRunway > 8) {
      status = 'watch';
    } else if (weeksRunway > 4) {
      status = 'warning';
    } else {
      status = 'critical';
    }

    return {
      weeksRunway: Core.round2(Math.min(weeksRunway, 999)),
      avgWeeklyBurn: Core.round2(avgWeeklyBurn),
      avgWeeklyInflow: Core.round2(avgWeeklyInflow),
      netWeeklyChange: Core.round2(netWeeklyChange),
      currentCash: Core.round2(currentBalance || 0),
      status: status,
      criticalWeeks: criticalWeeks
    };
  }

  // ================= STRATEGIES =================

  function processCategory(config, timeline, asOfDate, contextData) {
    const method = config.method || "gl_history_average";
    switch (method) {
      case "gl_history_average": return strategyGLHistory(config, timeline, asOfDate);
      case "vendor_payment_history": return strategyVendorPaymentHistory(config, timeline, asOfDate);
      case "credit_card_cycle": return strategyCreditCardCycle(config, timeline, asOfDate);
      case "manual_recurring": return strategyManualRecurring(config, timeline, asOfDate);
      case "formula_expression": return strategyFormula(config, timeline, asOfDate, contextData);
      case "vendor_recurring_average": return strategyVendorRecurringAverage(config, timeline, asOfDate);
      case "bank_register_history": return strategyBankRegisterHistory(config, timeline, asOfDate);
      default: return { total: 0, weeklyAmounts: {} };
    }
  }

  function strategyGLHistory(config, timeline, asOfDate) {
    const historyWeeks = parseInt(config.historyWeeks) || 12;
    const adjustmentPct = parseFloat(config.adjustmentPercent) || 0;
    const historyStart = addDays(timeline.start, -(historyWeeks * 7));

    const filters = [
      ["posting", "is", "T"], "AND",
      ["trandate", "onorafter", toNsDateString(historyStart)], "AND",
      ["trandate", "onorbefore", toNsDateString(timeline.end)],
    ];
    if (config.accounts && config.accounts.length > 0)
      filters.push("AND", ["account", "anyof", config.accounts]);
    else return { total: 0, weeklyAmounts: {} };

    const weeklyHistory = {};
    const accountBreakdown = {};
    let totalHistory = 0;
    let weeksCounted = 0;

    const searchObj = search.create({
      type: search.Type.TRANSACTION,
      filters: filters,
      columns: ["trandate", "amount", "account"],
    });

    const pagedData = searchObj.runPaged({ pageSize: 1000 });
    pagedData.pageRanges.forEach((pageRange) => {
      const page = pagedData.fetch({ index: pageRange.index });
      page.data.forEach((res) => {
        const rawAmt = parseFloat(res.getValue("amount")) || 0;
        const amt = config.useNetAmt === true ? rawAmt : Math.abs(rawAmt);
        const date = parseNsDate(res.getValue("trandate"));
        const wkKey = Core.formatDateForQuery(getWeekStart(date));
        const acct = res.getText("account");

        if (!weeklyHistory[wkKey]) weeklyHistory[wkKey] = 0;
        weeklyHistory[wkKey] += amt;

        if (date < timeline.start) {
          if (!accountBreakdown[acct]) accountBreakdown[acct] = 0;
          accountBreakdown[acct] += amt;
        }
      });
    });

    Object.keys(weeklyHistory).forEach((k) => {
      if (k < Core.formatDateForQuery(timeline.start)) {
        totalHistory += weeklyHistory[k];
        weeksCounted++;
      }
    });

    const divisor = weeksCounted > 0 ? weeksCounted : historyWeeks > 0 ? historyWeeks : 1;
    let weeklyAvg = totalHistory / divisor;
    if (adjustmentPct !== 0) weeklyAvg = weeklyAvg * (1 + adjustmentPct / 100);

    let forecastAmount = weeklyAvg;
    if (config.expectedWeek && config.expectedWeek !== "") forecastAmount = weeklyAvg * 4.345;

    const weeklyAmounts = {};
    let projectedTotal = 0;
    let curr = new Date(timeline.start);

    while (curr <= timeline.end) {
      const k = Core.formatDateForQuery(curr);
      let amount = weeklyHistory[k] > 0 ? weeklyHistory[k] : forecastAmount;
      const factor = getProrationFactor(curr, asOfDate, config.expectedDay, config.expectedWeek);
      amount = amount * factor;
      weeklyAmounts[k] = Core.round2(amount);
      projectedTotal += amount;
      curr = addDays(curr, 7);
    }

    return {
      total: Core.round2(projectedTotal),
      weeklyAmounts: weeklyAmounts,
      meta: {
        method: "GL Average",
        sourceTotal: Core.round2(totalHistory),
        weeksUsed: divisor,
        rawAverage: Core.round2(totalHistory / divisor),
        adjustment: adjustmentPct,
        finalAverage: Core.round2(weeklyAvg),
        expectedWeek: config.expectedWeek,
      },
      breakdown: Object.entries(accountBreakdown).map(([k, v]) => ({
        name: k, amount: Core.round2(v), type: "Source Data",
      })),
    };
  }

  function strategyVendorPaymentHistory(config, timeline, asOfDate) {
    const historyMonths = parseInt(config.historyMonths) || 12;
    const adjustmentPct = parseFloat(config.adjustmentPercent) || 0;
    const historyStart = addMonths(asOfDate, -historyMonths);
    const filters = [
      ["mainline", "is", "T"], "AND",
      ["type", "anyof", "Check", "VendPymt"], "AND",
      ["trandate", "onorafter", toNsDateString(historyStart)], "AND",
      ["trandate", "onorbefore", toNsDateString(asOfDate)],
    ];
    if (config.vendorCategories) filters.push("AND", ["vendor.category", "anyof", config.vendorCategories]);
    if (config.vendors) filters.push("AND", ["entity", "anyof", config.vendors]);

    const monthTotals = {};
    const searchObj = search.create({
      type: search.Type.TRANSACTION,
      filters: filters,
      columns: ["trandate", "amount"],
    });

    const pagedData = searchObj.runPaged({ pageSize: 1000 });
    pagedData.pageRanges.forEach((pageRange) => {
      const page = pagedData.fetch({ index: pageRange.index });
      page.data.forEach((res) => {
        const amt = Math.abs(parseFloat(res.getValue("amount")) || 0);
        const date = parseNsDate(res.getValue("trandate"));
        const mKey = `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, "0")}`;
        monthTotals[mKey] = (monthTotals[mKey] || 0) + amt;
      });
    });

    const values = Object.values(monthTotals).filter((v) => v > 0).sort((a, b) => a - b);
    let monthlyEst = 0;
    if (values.length > 0) {
      const mid = Math.floor(values.length / 2);
      monthlyEst = values.length % 2 !== 0 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
    }
    let weeklyEst = monthlyEst / 4.345;
    let baseAmount = (config.expectedWeek && config.expectedWeek !== "") ? monthlyEst : (monthlyEst / 4.345);
    if (adjustmentPct !== 0) baseAmount = baseAmount * (1 + adjustmentPct / 100);

    const weeklyAmounts = {};
    let total = 0;
    let curr = new Date(timeline.start);

    while (curr <= timeline.end) {
      const k = Core.formatDateForQuery(curr);
      let amount = baseAmount * getProrationFactor(curr, asOfDate, config.expectedDay, config.expectedWeek);
      weeklyAmounts[k] = Core.round2(amount);
      total += amount;
      curr = addDays(curr, 7);
    }

    const breakdown = Object.entries(monthTotals)
      .map(([k, v]) => ({ name: k, amount: Core.round2(v), type: "Source Month" }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return {
      total: Core.round2(total),
      weeklyAmounts: weeklyAmounts,
      meta: {
        method: "Vendor History (Median)",
        monthlyMedian: Core.round2(monthlyEst),
        adjustment: adjustmentPct,
        finalWeekly: Core.round2(weeklyEst),
      },
      breakdown: breakdown,
    };
  }

  function strategyCreditCardCycle(config, timeline, asOfDate) {
    const accountIds = config.accountIds || [];
    if (!accountIds.length) {
      return {
        total: 0,
        weeklyAmounts: {},
        meta: { error: "No Credit Card Accounts Selected" },
      };
    }

    // Configuration
    const lookbackMonths = parseInt(config.historyMonths) || 6;
    const lookbackDays = lookbackMonths * 30;
    const historyStart = addDays(asOfDate, -lookbackDays);
    // Configurable threshold for significant payment detection (default: auto-detect from median)
    const significantPaymentThreshold = parseFloat(config.significantPaymentThreshold) || 0;

    // ========== PHASE 1: Gather Transaction Data ==========
    const dailyTotals = {};
    let grandTotalSpend = 0;
    let grandTotalPayments = 0;

    const searchObj = search.create({
      type: search.Type.TRANSACTION,
      filters: [
        ["posting", "is", "T"],
        "AND",
        ["account", "anyof", accountIds],
        "AND",
        ["trandate", "onorafter", toNsDateString(historyStart)],
        "AND",
        ["trandate", "onorbefore", toNsDateString(asOfDate)],
      ],
      columns: ["trandate", "creditamount", "debitamount"],
    });

    const pagedData = searchObj.runPaged({ pageSize: 1000 });
    pagedData.pageRanges.forEach((pageRange) => {
      const page = pagedData.fetch({ index: pageRange.index });
      page.data.forEach((res) => {
        const credit = parseFloat(res.getValue("creditamount")) || 0;
        const debit = parseFloat(res.getValue("debitamount")) || 0;
        const dateStr = res.getValue("trandate");
        const dateObj = parseNsDate(dateStr);
        const dateKey = Core.formatDateForQuery(dateObj);

        if (!dailyTotals[dateKey]) {
          dailyTotals[dateKey] = { date: dateObj, debits: 0, credits: 0 };
        }

        if (credit > 0) {
          dailyTotals[dateKey].credits += credit;
          grandTotalSpend += credit;
        }

        if (debit > 0) {
          dailyTotals[dateKey].debits += debit;
          grandTotalPayments += debit;
        }
      });
    });

    // ========== PHASE 2: Roll Up Payments by Month ==========
    const monthlyPayments = {};
    const monthlySpend = {};

    Object.entries(dailyTotals).forEach(([dateKey, data]) => {
      const monthKey = dateKey.substring(0, 7);

      if (data.debits > 0) {
        if (!monthlyPayments[monthKey]) {
          monthlyPayments[monthKey] = { total: 0, payments: [], paymentDays: [], largestPaymentDay: null, largestPaymentAmount: 0 };
        }
        monthlyPayments[monthKey].total += data.debits;
        monthlyPayments[monthKey].payments.push({ amount: data.debits, day: data.date.getDate() });
        monthlyPayments[monthKey].paymentDays.push(data.date.getDate());
        
        if (data.debits > monthlyPayments[monthKey].largestPaymentAmount) {
          monthlyPayments[monthKey].largestPaymentAmount = data.debits;
          monthlyPayments[monthKey].largestPaymentDay = data.date.getDate();
        }
      }

      if (data.credits > 0) {
        if (!monthlySpend[monthKey]) monthlySpend[monthKey] = 0;
        monthlySpend[monthKey] += data.credits;
      }
    });

    // ========== PHASE 3: Analyze Monthly Payment Patterns ==========
    const monthlyTotals = Object.entries(monthlyPayments)
      .map(([month, data]) => ({
        month: month,
        total: data.total,
        paymentCount: data.payments.length,
        largestPaymentDay: data.largestPaymentDay,
      }))
      .sort((a, b) => a.month.localeCompare(b.month));

    const currentMonth = Core.formatDateForQuery(asOfDate).substring(0, 7);
    const dayOfMonth = asOfDate.getDate();

    const completedMonths = monthlyTotals.filter((m) => {
      if (m.month < currentMonth) return true;
      if (m.month === currentMonth && m.total > 0 && dayOfMonth >= m.largestPaymentDay) {
        return true;
      }
      return false;
    });

    // ========== PHASE 4: Calculate Statistics ==========
    let medianPayment = 0;
    let avgPayment = 0;
    let paymentTrend = 0;

    if (completedMonths.length > 0) {
      const amounts = completedMonths.map((m) => m.total);
      const sorted = [...amounts].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      medianPayment = sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
      avgPayment = amounts.reduce((a, b) => a + b, 0) / amounts.length;

      if (completedMonths.length >= 4) {
        const recent = completedMonths.slice(-3);
        const older = completedMonths.slice(0, -3);
        const recentAvg = recent.reduce((s, m) => s + m.total, 0) / recent.length;
        const olderAvg = older.reduce((s, m) => s + m.total, 0) / older.length;
        paymentTrend = ((recentAvg - olderAvg) / olderAvg) * 100;
      }
    } else {
      const monthlySpendRate = (grandTotalSpend / lookbackDays) * 30;
      medianPayment = monthlySpendRate;
      avgPayment = monthlySpendRate;
    }

    // ========== PHASE 5: Detect Primary Payment Day ==========
    const primaryPaymentDays = completedMonths
      .filter((m) => m.largestPaymentDay !== null)
      .map((m) => m.largestPaymentDay);

    let detectedPaymentDay = 24;
    if (primaryPaymentDays.length > 0) {
      const dayCounts = {};
      primaryPaymentDays.forEach((day) => {
        dayCounts[day] = (dayCounts[day] || 0) + 1;
      });

      let maxCount = 0;
      Object.entries(dayCounts).forEach(([day, count]) => {
        if (count > maxCount) {
          maxCount = count;
          detectedPaymentDay = parseInt(day);
        }
      });

      if (maxCount === 1 && primaryPaymentDays.length > 1) {
        const sortedDays = [...primaryPaymentDays].sort((a, b) => a - b);
        const mid = Math.floor(sortedDays.length / 2);
        detectedPaymentDay = sortedDays[mid];
      }
    }

    // ========== PHASE 6: Get Current Balance ==========
    let totalCurrentBalance = 0;
    search
      .create({
        type: search.Type.ACCOUNT,
        filters: [
          ["internalid", "anyof", accountIds],
          "AND",
          ["isinactive", "is", "F"],
        ],
        columns: [
          search.createColumn({ name: "balance", summary: search.Summary.SUM }),
        ],
      })
      .run()
      .each((res) => {
        totalCurrentBalance = Math.abs(
          parseFloat(res.getValue({ name: "balance", summary: search.Summary.SUM })) || 0
        );
        return true;
      });

    // ========== PHASE 7: Calculate Cycle Position & Projections ==========
    const dailyBurnRate = grandTotalSpend / lookbackDays;

    // Use configured threshold, or auto-detect as 50% of median payment
    const effectiveThreshold = significantPaymentThreshold > 0
      ? significantPaymentThreshold
      : (medianPayment > 0 ? medianPayment * 0.5 : 10000);

    const significantPayments = Object.entries(dailyTotals)
      .filter(([_, data]) => data.debits > effectiveThreshold)
      .map(([dateKey, data]) => ({ date: data.date, dateKey: dateKey, amount: data.debits }))
      .sort((a, b) => b.date - a.date);

    const lastPaymentDate = significantPayments.length > 0 ? significantPayments[0].date : null;
    const lastPaymentDateStr = lastPaymentDate ? Core.formatDateForQuery(lastPaymentDate) : null;
    const daysSinceLastPayment = lastPaymentDate
      ? Math.ceil((asOfDate - lastPaymentDate) / (1000 * 60 * 60 * 24))
      : 30;

    let nextPaymentDate = new Date(asOfDate);
    nextPaymentDate.setDate(detectedPaymentDay);

    if (nextPaymentDate <= asOfDate) {
      nextPaymentDate = addMonths(nextPaymentDate, 1);
      nextPaymentDate.setDate(Math.min(detectedPaymentDay, getDaysInMonth(nextPaymentDate)));
    }
    nextPaymentDate = adjustToBusinessDay(nextPaymentDate);
    const nextPaymentDateStr = Core.formatDateForQuery(nextPaymentDate);

    const daysUntilPayment = Math.ceil((nextPaymentDate - asOfDate) / (1000 * 60 * 60 * 24));

    // Projected Growth Calculation
    const typicalCycleDays = 30;
    const daysFromPaymentToStatementClose = typicalCycleDays - 3;
    const cycleProgress = Math.min(totalCurrentBalance / medianPayment, 1.0);
    const daysAlreadyAccrued = cycleProgress * daysFromPaymentToStatementClose;
    const daysRemainingToAccrue = Math.max(0, daysFromPaymentToStatementClose - daysAlreadyAccrued);
    const projectedGrowth = dailyBurnRate * daysRemainingToAccrue;

    // ========== PHASE 8: Projection ==========
    const trajectoryEstimate = totalCurrentBalance + projectedGrowth;
    const varianceFromMedian = Math.abs(trajectoryEstimate - medianPayment) / medianPayment;
    
    let projectedPayment;
    let projectionMethod;
    
    if (varianceFromMedian <= 0.20) {
      projectedPayment = trajectoryEstimate;
      projectionMethod = "Current Cycle Trajectory";
    } else if (trajectoryEstimate < medianPayment) {
      projectedPayment = medianPayment;
      projectionMethod = "Historical Median (Low Trajectory)";
    } else {
      projectedPayment = (medianPayment * 0.7) + (trajectoryEstimate * 0.3);
      projectionMethod = "Blended (High Trajectory)";
    }
    
    const adjustedProjectedGrowth = projectedPayment - totalCurrentBalance;

    // ========== PHASE 9: Build Forecast ==========
    const weeklyAmounts = {};
    let totalProjected = 0;
    const breakdown = [];

    completedMonths.forEach((m) => {
      const monthDate = new Date(m.month + "-01");
      const monthName = monthDate.toLocaleString("default", { month: "short", year: "numeric" });
      breakdown.push({
        name: monthName,
        amount: Core.round2(m.total),
        type: "Historical",
        details: m.paymentCount + " payment(s), Day " + m.largestPaymentDay,
      });
    });

    let paymentDate = new Date(nextPaymentDate);
    let isFirstPayment = true;

    while (paymentDate <= timeline.end) {
      const weekKey = Core.formatDateForQuery(getWeekStart(paymentDate));
      const amountToPay = Core.round2(isFirstPayment ? projectedPayment : medianPayment);

      weeklyAmounts[weekKey] = (weeklyAmounts[weekKey] || 0) + amountToPay;
      totalProjected += amountToPay;

      if (isFirstPayment) {
        breakdown.unshift({
          name: "Next Payment",
          amount: amountToPay,
          date: Core.formatDateForQuery(paymentDate),
          type: "Projection",
          details: projectionMethod,
        });
        isFirstPayment = false;
      }

      paymentDate = addMonths(paymentDate, 1);
      paymentDate.setDate(Math.min(detectedPaymentDay, getDaysInMonth(paymentDate)));
      paymentDate = adjustToBusinessDay(paymentDate);
    }

    breakdown.push({
      name: "Current Balance",
      amount: Core.round2(totalCurrentBalance),
      type: "Info",
      details: daysSinceLastPayment + " days since last payment",
    });

    return {
      total: Core.round2(totalProjected),
      weeklyAmounts: weeklyAmounts,
      meta: {
        method: "Credit Card Cycle",
        detectedPaymentDay: detectedPaymentDay,
        medianPayment: Core.round2(medianPayment),
        avgPayment: Core.round2(avgPayment),
        currentBalance: Core.round2(totalCurrentBalance),
        daysSinceLastPayment: daysSinceLastPayment,
        dailyBurnRate: Core.round2(dailyBurnRate),
        monthlySpendRate: Core.round2(dailyBurnRate * 30),
        paymentTrend: Core.round2(paymentTrend) + "%",
        monthsAnalyzed: completedMonths.length,
        accountsIncluded: accountIds.length,
        lastPaymentDate: lastPaymentDateStr,
        outstanding: Core.round2(totalCurrentBalance),
        projectedGrowth: Core.round2(adjustedProjectedGrowth),
        nextPaymentDate: nextPaymentDateStr,
        estimatedMonthly: Core.round2(medianPayment),
      },
      breakdown: breakdown,
    };
  }

  // Helper: Get days in month
  function getDaysInMonth(date) {
    const d = new Date(date);
    return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  }

  function strategyManualRecurring(config, timeline, asOfDate) {
    const weeklyAmounts = {};
    let total = 0;
    const amount = config.amount || 0;
    const frequency = config.frequency || "weekly";
    let curr = new Date(timeline.start);

    while (curr <= timeline.end) {
      const wkKey = Core.formatDateForQuery(getWeekStart(curr));
      let currentAmount = amount;
      if (frequency === "weekly") {
        const factor = getProrationFactor(curr, asOfDate, null);
        currentAmount = currentAmount * factor;
      }
      weeklyAmounts[wkKey] = (weeklyAmounts[wkKey] || 0) + currentAmount;
      total += currentAmount;

      if (frequency === "monthly") curr = addMonths(curr, 1);
      else if (frequency === "bi_weekly") curr = addDays(curr, 14);
      else curr = addDays(curr, 7);
    }
    return {
      total: Core.round2(total), weeklyAmounts: weeklyAmounts,
      breakdown: [{ name: `Manual (${frequency})`, amount: amount }],
      meta: { method: "Manual Recurring", amount: amount, frequency: frequency },
    };
  }

  function strategyFormula(config, timeline, asOfDate, contextData) {
    const weeklyAmounts = {};
    let total = 0;
    let expression = (config.formula || "0").toUpperCase();
    expression = expression
      .replace(/IF\s*\(([^,]+),([^,]+),([^)]+)\)/g, "($1 ? $2 : $3)")
      .replace(/MAX\(/g, "Math.max(")
      .replace(/MIN\(/g, "Math.min(")
      .replace(/ABS\(/g, "Math.abs(")
      .replace(/CEIL\(/g, "Math.ceil(")
      .replace(/FLOOR\(/g, "Math.floor(")
      .replace(/ROUND\(/g, "Math.round(")
      .replace(/SQRT\(/g, "Math.sqrt(")
      .replace(/POW\(/g, "Math.pow(")
      .replace(/AVG\(/g, "( (...args) => args.reduce((a,b)=>a+b,0)/args.length )(");

    let curr = new Date(timeline.start);
    let weekIndex = 1;
    const globalStartCash = contextData.cashStart || 0;

    while (curr <= timeline.end) {
      const k = Core.formatDateForQuery(curr);
      const val_AR = contextData && contextData.ar ? contextData.ar[k] || 0 : 0;
      const val_AP = contextData && contextData.ap ? contextData.ap[k] || 0 : 0;
      const val_Net = val_AR - val_AP;
      const val_CashStart = globalStartCash;

      const dObj = new Date(curr);
      const monthNum = dObj.getMonth() + 1;
      const yearNum = dObj.getFullYear();
      const dayOfMonth = dObj.getDate();
      const quarter = Math.ceil(monthNum / 3);

      const isWk1 = weekIndex === 1 ? 1 : 0;
      const isWk2 = weekIndex === 2 ? 1 : 0;
      const isWk3 = weekIndex === 3 ? 1 : 0;
      const isWk4 = weekIndex === 4 ? 1 : 0;
      const isWk5 = weekIndex >= 5 ? 1 : 0;
      const weekEndObj = addDays(curr, 6);
      const isMonthStart = dayOfMonth <= 7 ? 1 : 0;
      const isMonthEnd = weekEndObj.getMonth() !== dObj.getMonth() || dayOfMonth >= 25 ? 1 : 0;
      const isQStart = monthNum % 3 === 1 && isMonthStart ? 1 : 0;
      const isQEnd = monthNum % 3 === 0 && isMonthEnd ? 1 : 0;
      const isYearEnd = monthNum === 12 && isMonthEnd ? 1 : 0;

      let evalStr = expression
        .replace(/{AR_IN}/g, val_AR).replace(/{AP_OUT}/g, val_AP)
        .replace(/{NET_FLOW}/g, val_Net).replace(/{CASH_START}/g, val_CashStart)
        .replace(/{WEEK_NUM}/g, weekIndex).replace(/{MONTH}/g, monthNum)
        .replace(/{QUARTER}/g, quarter).replace(/{YEAR}/g, yearNum)
        .replace(/{DAY}/g, dayOfMonth).replace(/{IS_WK1}/g, isWk1)
        .replace(/{IS_WK2}/g, isWk2).replace(/{IS_WK3}/g, isWk3)
        .replace(/{IS_WK4}/g, isWk4).replace(/{IS_WK5}/g, isWk5)
        .replace(/{IS_MONTH_START}/g, isMonthStart).replace(/{IS_MONTH_END}/g, isMonthEnd)
        .replace(/{IS_Q_START}/g, isQStart).replace(/{IS_Q_END}/g, isQEnd)
        .replace(/{IS_YEAR_END}/g, isYearEnd).replace(/{TAX_RATE}/g, 0.13)
        .replace(/{TRUE}/g, 1).replace(/{FALSE}/g, 0);

      const safePattern = /[^0-9+\-*/().\s?:><=&|!%,Math=>argsducelngth]/gi;
      const sanitized = evalStr.replace(safePattern, "");

      let result = 0;
      try {
        const func = new Function("return " + sanitized);
        result = func();
        if (!isFinite(result)) result = 0;
      } catch (e) { result = 0; }

      weeklyAmounts[k] = Core.round2(result);
      total += result;
      curr = addDays(curr, 7);
      weekIndex++;
    }
    return {
      total: Core.round2(total), weeklyAmounts: weeklyAmounts,
      meta: { method: "Calculated Formula", formula: config.formula },
      breakdown: [{ name: "Computed via Formula", amount: total }],
    };
  }

  function strategyVendorRecurringAverage(config, timeline, asOfDate) {
    const vIds = config.vendorIds || (config.vendorId ? [config.vendorId] : []);
    if (!vIds.length) return { total: 0, weeklyAmounts: {} };

    const months = parseInt(config.historyMonths) || 3;
    const adjustmentPct = parseFloat(config.adjustmentPercent) || 0;
    const historyStart = addMonths(asOfDate, -months);
    const paymentEvents = {};

    const searchObj = search.create({
      type: search.Type.TRANSACTION,
      filters: [
        ["mainline", "is", "T"], "AND",
        ["type", "anyof", "Check", "VendPymt"], "AND",
        ["entity", "anyof", vIds], "AND",
        ["trandate", "onorafter", toNsDateString(historyStart)],
      ],
      columns: ["trandate", "amount"],
    });

    const pagedData = searchObj.runPaged({ pageSize: 1000 });
    pagedData.pageRanges.forEach((pageRange) => {
      const page = pagedData.fetch({ index: pageRange.index });
      page.data.forEach((res) => {
        const amt = Math.abs(parseFloat(res.getValue("amount")) || 0);
        const dStr = res.getValue("trandate");
        paymentEvents[dStr] = (paymentEvents[dStr] || 0) + amt;
      });
    });

    let events = Object.keys(paymentEvents).map((k) => ({
        date: parseNsDate(k), amount: paymentEvents[k],
      })).sort((a, b) => b.date - a.date);

    if (events.length < 2) return { total: 0, weeklyAmounts: {} };

    const intervals = [];
    const amounts = [];
    for (let i = 0; i < events.length - 1; i++) {
      const diffTime = Math.abs(events[i].date - events[i + 1].date);
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      intervals.push(diffDays);
    }
    events.forEach((e) => amounts.push(e.amount));
    intervals.sort((a, b) => a - b);
    const medianInterval = intervals[Math.floor(intervals.length / 2)];

    let frequencyLabel = "Monthly";
    let nextIntervalDays = 30;
    if (medianInterval >= 5 && medianInterval <= 9) {
      frequencyLabel = "Weekly"; nextIntervalDays = 7;
    } else if (medianInterval >= 12 && medianInterval <= 16) {
      frequencyLabel = "Bi-Weekly"; nextIntervalDays = 14;
    }

    const mean = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    const variance = amounts.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / amounts.length;
    const stdDev = Math.sqrt(variance);

    let filteredAmounts = amounts;
    if (amounts.length >= 4 && stdDev > 0) {
      filteredAmounts = amounts.filter((a) => Math.abs(a - mean) <= 2 * stdDev);
    }
    let avgAmount = filteredAmounts.reduce((a, b) => a + b, 0) / filteredAmounts.length;
    if (adjustmentPct !== 0) avgAmount = avgAmount * (1 + adjustmentPct / 100);

    const weeklyAmounts = {};
    let total = 0;
    let nextDate = addDays(events[0].date, nextIntervalDays);
    const today = new Date(asOfDate);
    while (nextDate < today) { nextDate = addDays(nextDate, nextIntervalDays); }

    while (nextDate <= timeline.end) {
      const wkKey = Core.formatDateForQuery(getWeekStart(nextDate));
      weeklyAmounts[wkKey] = (weeklyAmounts[wkKey] || 0) + Core.round2(avgAmount);
      total += avgAmount;
      nextDate = addDays(nextDate, nextIntervalDays);
    }

    const historyBreakdown = events.map((e) => ({
      name: "Historical Payment", amount: Core.round2(e.amount),
      date: Core.formatDateForQuery(e.date), type: "Source Data",
    }));

    return {
      total: Core.round2(total), weeklyAmounts: weeklyAmounts,
      meta: {
        method: "Vendor Recurring (Auto)", frequency: frequencyLabel,
        avgAmount: Core.round2(avgAmount), samples: events.length, interval: medianInterval,
      },
      breakdown: historyBreakdown,
    };
  }

  function strategyBankRegisterHistory(config, timeline, asOfDate) {
    const historyWeeks = parseInt(config.historyWeeks) || 12;
    const adjustmentPct = parseFloat(config.adjustmentPercent) || 0;
    const bankIds = config.bankAccountIds || ["1"];

    if (bankIds.length === 0) return { total: 0, weeklyAmounts: {}, meta: { error: "Configuration Error: No Bank Account IDs selected." } };

    const historyStartDate = addDays(timeline.start, -(historyWeeks * 7));
    const startStr = Core.formatDateForQuery(historyStartDate);
    const endStr = Core.formatDateForQuery(timeline.end);

    let typeList = [];
    if (config.includeTransfers !== false) { typeList.push("'Transfer'"); typeList.push("'Trnfr'"); }
    if (config.includeChecks !== false) { 
        typeList.push("'Check'"); typeList.push("'VendPymt'"); 
        typeList.push("'Paycheck'"); typeList.push("'TaxPymt'"); typeList.push("'TaxLiabPymt'"); 
    }
    if (config.includeJournals === true) { typeList.push("'Journal'"); }
    
    let typeSql = "";
    if (typeList.length > 0) typeSql = `AND t.type IN (${typeList.join(',')})`;

    let memoSql = "";
    if (config.memoKeywords && config.memoKeywords.length > 0) {
        const conditions = config.memoKeywords
            .filter(k => k.trim() !== "")
            .map(k => `t.memo LIKE '%${k}%'`); 
        if (conditions.length > 0) memoSql = `AND (${conditions.join(' OR ')})`;
    }

    const sql = `
        SELECT t.id, t.trandate, t.type, t.tranid, t.memo AS header_memo, tal.netamount, tal.credit, BUILTIN.DF(t.entity) AS entity_name
        FROM Transaction t
        JOIN TransactionAccountingLine tal ON t.id = tal.transaction
        WHERE tal.account IN (${bankIds.join(',')})
        AND (tal.credit > 0 OR tal.netamount < 0)
        AND t.trandate >= TO_DATE('${startStr}', 'YYYY-MM-DD')
        AND t.trandate <= TO_DATE('${endStr}', 'YYYY-MM-DD')
        ${typeSql} ${memoSql}
        ORDER BY t.trandate DESC
    `;

    const weeklyHistory = {};
    const breakdown = [];
    let totalHistory = 0;
    let weeksCounted = 0;

    try {
        const resultSet = query.runSuiteQL({ query: sql });
        const results = resultSet.asMappedResults();
        const currentWeekStartForBreakdown = getWeekStart(asOfDate);
        
        results.forEach(res => {
            let absAmount = 0;
            const creditVal = parseFloat(res.credit) || 0;
            const netVal = parseFloat(res.netamount) || 0;
            if (creditVal > 0) absAmount = creditVal; else absAmount = Math.abs(netVal);
            if (absAmount === 0) return;
            const date = parseNsDate(res.trandate); 
            if (!date) return; 
            const wkKey = Core.formatDateForQuery(getWeekStart(date));
            if (!weeklyHistory[wkKey]) weeklyHistory[wkKey] = 0;
            weeklyHistory[wkKey] += absAmount;
            
            // Include both historical transactions AND current week transactions in breakdown
            // Current week transactions show what's already been applied against the forecast
            const isCurrentWeek = date >= currentWeekStartForBreakdown && date < addDays(currentWeekStartForBreakdown, 7);
            if (date < timeline.start || isCurrentWeek) {
                breakdown.push({
                    name: `${Core.formatDateForQuery(date)} ${res.type} ${res.entity_name || ''} ${res.tranid ? '('+res.tranid+')' : ''}`,
                    memo: res.header_memo || "", amount: Core.round2(absAmount),
                    type: isCurrentWeek ? "This Week (Applied)" : "Bank Register", 
                    date: Core.formatDateForQuery(date),
                    internalId: res.id, tranId: res.tranid
                });
            }
        });
    } catch (e) {
        return { total: 0, weeklyAmounts: {}, meta: { error: "SuiteQL Error", details: e.message } };
    }

    const startKey = Core.formatDateForQuery(timeline.start);
    Object.keys(weeklyHistory).forEach((k) => {
      if (k < startKey) { totalHistory += weeklyHistory[k]; weeksCounted++; }
    });

    const divisor = weeksCounted > 0 ? weeksCounted : historyWeeks > 0 ? historyWeeks : 1;
    let weeklyAvg = totalHistory / divisor;
    if (adjustmentPct !== 0) weeklyAvg = weeklyAvg * (1 + adjustmentPct / 100);

    const weeklyAmounts = {};
    let projectedTotal = 0;
    let curr = new Date(timeline.start);
    
    // Determine current week key for special handling
    const currentWeekKey = Core.formatDateForQuery(getWeekStart(asOfDate));

    while (curr <= timeline.end) {
      const k = Core.formatDateForQuery(curr);
      const actualThisWeek = weeklyHistory[k] || 0;
      let amount;
      
      if (k === currentWeekKey && actualThisWeek > 0) {
        // Current week: subtract actual transactions from forecast, show remaining
        // If actual exceeds forecast, floor at 0
        amount = Math.max(0, weeklyAvg - actualThisWeek);
      } else if (actualThisWeek > 0 && k > currentWeekKey) {
        // Future weeks with scheduled transactions: use the actual (rare case)
        amount = actualThisWeek;
      } else {
        // Future weeks without actuals: use forecast average
        amount = weeklyAvg;
      }
      
      const factor = getProrationFactor(curr, asOfDate, config.expectedDay, config.expectedWeek);
      amount = amount * factor;
      weeklyAmounts[k] = Core.round2(amount);
      projectedTotal += amount;
      curr = addDays(curr, 7);
    }
    
    // Calculate current week applied amount for meta
    const currentWeekApplied = weeklyHistory[currentWeekKey] || 0;

    return {
      total: Core.round2(projectedTotal), weeklyAmounts: weeklyAmounts,
      meta: {
        method: "Bank Register History", bankAccounts: bankIds,
        historyWeeks: historyWeeks, memoKeywords: config.memoKeywords,
        rawAverage: Core.round2(totalHistory / divisor || 0),
        finalAverage: Core.round2(weeklyAvg), weeksUsed: divisor,
        currentWeekApplied: Core.round2(currentWeekApplied)
      },
      breakdown: breakdown,
    };
  }

  // ================= HELPERS & BUILDERS =================

  function buildARForecast(timeline, statsData, volatilityThresholds, overduePushDays) {
    const invoices = [];
    const weeklyMap = {};
    let totalOutstanding = 0;
    const buckets = { Current: 0, "1-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };

    // Use configurable thresholds with defaults
    const stableThreshold = volatilityThresholds.stable || 5;
    const volatileThreshold = volatilityThresholds.volatile || 15;
    const pushLight = overduePushDays.light || 7;
    const pushMedium = overduePushDays.medium || 14;
    const pushHeavy = overduePushDays.heavy || 28;

    const searchObj = search.create({
      type: search.Type.INVOICE,
      filters: [
        ["mainline", "is", "T"], "AND",
        ["amountremaining", "greaterthan", 0], "AND",
        ["status", "noneof", "CustInvc:V"],
      ],
      columns: [
        "amountremaining", "trandate", "duedate", "entity",
        "custbodyexpected_pay_date", "tranid", "terms",
      ],
    });

    const pagedData = searchObj.runPaged({ pageSize: 1000 });
    pagedData.pageRanges.forEach((pageRange) => {
      const page = pagedData.fetch({ index: pageRange.index });
      page.data.forEach((res) => {
        const amt = parseFloat(res.getValue("amountremaining")) || 0;
        const trandate = parseNsDate(res.getValue("trandate"));
        const duedate = res.getValue("duedate") ? parseNsDate(res.getValue("duedate")) : null;
        const entityName = res.getText("entity");
        const entityId = res.getValue("entity");
        const customDateRaw = res.getValue("custbodyexpected_pay_date");
        const termsDays = res.getValue("terms") ? parseInt(res.getText("terms").replace(/\D/g, "")) : null;

        totalOutstanding += amt;

        // Calculate days past due for display
        let daysOverDue = 0;
        if (duedate) {
          const diffTime = timeline.asOfDate - duedate;
          const daysPastDue = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
          daysOverDue = daysPastDue;
          if (daysPastDue <= 0) buckets["Current"] += amt;
          else if (daysPastDue <= 30) buckets["1-30"] += amt;
          else if (daysPastDue <= 60) buckets["31-60"] += amt;
          else if (daysPastDue <= 90) buckets["61-90"] += amt;
          else buckets["90+"] += amt;
        } else buckets["Current"] += amt;

        let predictedDate;
        let predictionMethod = "Default";
        let predictionDetail = statsData.globalAvg + "d global avg";

        if (customDateRaw) {
          predictedDate = parseNsDate(customDateRaw);
          predictionMethod = "Custom";
          predictionDetail = "Expected pay date";
        } else if (statsData.map[entityId]) {
          const s = statsData.map[entityId];
          const buffer = s.stdDev ? Math.ceil(s.stdDev * 0.5) : 0;
          predictedDate = addDays(trandate, s.avgDays + buffer);
          predictionMethod = "Statistical";
          predictionDetail = s.avgDays + "d avg + " + buffer + "d buffer";
        } else if (termsDays) {
          predictedDate = addDays(trandate, termsDays);
          predictionMethod = "Terms";
          predictionDetail = termsDays + "d from terms";
        } else {
          predictedDate = addDays(trandate, statsData.globalAvg);
        }

        if (duedate && predictedDate < duedate) {
          predictedDate = duedate;
          if (predictionMethod !== "Custom") {
            predictionDetail += " (due date floor)";
          }
        }

        if (predictedDate < timeline.asOfDate) {
          const diffDays = Math.ceil((timeline.asOfDate - predictedDate) / (1000 * 60 * 60 * 24));
          // Use configurable push days
          let pushDays = pushLight;
          if (diffDays > 60) pushDays = pushHeavy;
          else if (diffDays > 30) pushDays = pushMedium;
          predictedDate = addDays(timeline.asOfDate, pushDays);
          predictionDetail += " (pushed +" + pushDays + "d)";
        }

        predictedDate = adjustToBusinessDay(predictedDate);

        if (predictedDate >= timeline.start && predictedDate <= timeline.end) {
          const wkKey = Core.formatDateForQuery(getWeekStart(predictedDate));
          weeklyMap[wkKey] = (weeklyMap[wkKey] || 0) + amt;
          // Use configurable volatility thresholds
          let volLabel = "Avg";
          if (statsData.map[entityId]) {
            if (statsData.map[entityId].stdDev < stableThreshold) volLabel = "Stable";
            else if (statsData.map[entityId].stdDev > volatileThreshold) volLabel = "Volatile";
          }
          invoices.push({
            internalId: res.id,
            tranId: res.getValue("tranid") || "ID:" + res.id,
            id: res.getValue("tranid") || "ID:" + res.id, // backward compat
            entityId: entityId,
            entityName: entityName,
            entity: entityName, // backward compat
            amount: amt,
            tranDate: Core.formatDateForQuery(trandate),
            dueDate: duedate ? Core.formatDateForQuery(duedate) : "-",
            duedate: duedate ? Core.formatDateForQuery(duedate) : "-", // backward compat
            predictedDate: Core.formatDateForQuery(predictedDate),
            date: Core.formatDateForQuery(predictedDate), // backward compat
            weekStart: wkKey,
            volatility: volLabel,
            daysOverDue: daysOverDue,
            predictionMethod: predictionMethod,
            predictionDetail: predictionDetail,
          });
        }
      });
    });

    // Calculate % current from buckets
    const currentAmountAR = buckets["Current"] || 0;
    const pctCurrentAR = totalOutstanding > 0 ? (currentAmountAR / totalOutstanding) * 100 : 0;

    return {
      summary: {
        outstandingTotal: Core.round2(totalOutstanding),
        totalOutstanding: Core.round2(totalOutstanding),
        avgDaysToPay: statsData.globalAvg,
        avgDaysUsed: statsData.globalAvg,
        pctCurrent: Core.round2(pctCurrentAR),
        invoices: invoices,
        buckets: Object.entries(buckets).map(([k, v]) => ({ label: k, amount: Core.round2(v) })),
      },
      weeklyMap: weeklyMap,
    };
  }

  function buildAPForecast(timeline, statsData, exclusions, overduePushDays) {
    const weeklyMap = {};
    let totalOutstanding = 0;
    const bills = [];
    const buckets = { Current: 0, "1-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };

    // Get authoritative AP balance directly from GL (matches balance sheet exactly)
    try {
      const apBalanceResult = query.runSuiteQL({
        query: `SELECT SUM(account.balance) as ap_balance FROM account WHERE account.accttype = 'AcctPay' AND account.isinactive = 'F'`
      }).asMappedResults();
      if (apBalanceResult.length > 0 && apBalanceResult[0].ap_balance != null) {
        totalOutstanding = Math.abs(parseFloat(apBalanceResult[0].ap_balance)) || 0;
      }
    } catch (e) {
      log.debug("buildAPForecast", "SuiteQL AP balance query failed, falling back to transaction search: " + e.message);
    }

    // Subtract excluded vendor categories from AP total
    const hasExclusions = exclusions && exclusions.excludeVendorCategories && exclusions.excludeVendorCategories.length;
    if (hasExclusions && totalOutstanding > 0) {
      try {
        let excludedTotal = 0;
        const excludedSearch = search.create({
          type: search.Type.VENDOR_BILL,
          filters: [
            ["mainline", "is", "T"], "AND",
            ["amountremaining", "greaterthan", 0], "AND",
            ["vendor.category", "anyof", exclusions.excludeVendorCategories]
          ],
          columns: [search.createColumn({ name: "amountremaining", summary: search.Summary.SUM })]
        });
        excludedSearch.run().each(function(result) {
          excludedTotal = parseFloat(result.getValue({ name: "amountremaining", summary: search.Summary.SUM })) || 0;
          return true;
        });
        if (excludedTotal > 0) {
          log.debug("buildAPForecast", "Excluding " + excludedTotal + " from vendor categories: " + exclusions.excludeVendorCategories.join(','));
          totalOutstanding -= excludedTotal;
        }
      } catch (e) {
        log.error("buildAPForecast", "Excluded vendor category search failed: " + e.message);
      }
    }

    const filters = [["mainline", "is", "T"], "AND", ["amountremaining", "greaterthan", 0]];
    if (hasExclusions) {
      filters.push("AND", ["vendor.category", "noneof", exclusions.excludeVendorCategories]);
    }

    // Use configurable push days with defaults (matching AR logic)
    const pushLight = overduePushDays.light || 7;
    const pushMedium = overduePushDays.medium || 14;
    const pushHeavy = overduePushDays.heavy || 28;

    const searchObj = search.create({
      type: search.Type.VENDOR_BILL,
      filters: filters,
      columns: ["amountremaining", "trandate", "duedate", "entity", "custbodyexpected_pay_date", "tranid", "vendor.category"],
    });

    const pagedData = searchObj.runPaged({ pageSize: 1000 });
    pagedData.pageRanges.forEach((pageRange) => {
      const page = pagedData.fetch({ index: pageRange.index });
      page.data.forEach((res) => {
        const amt = parseFloat(res.getValue("amountremaining")) || 0;
        const trandate = parseNsDate(res.getValue("trandate"));
        const duedate = res.getValue("duedate") ? parseNsDate(res.getValue("duedate")) : null;
        const entityName = res.getText("entity");
        const entityId = res.getValue("entity");
        const customDateRaw = res.getValue("custbodyexpected_pay_date");
        const vendorCat = res.getValue({ name: "category", join: "vendor" });

        // Calculate days past due for display
        let daysOverDue = 0;
        if (duedate) {
          const diffTime = timeline.asOfDate - duedate;
          const daysPastDue = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
          daysOverDue = daysPastDue;
          if (daysPastDue <= 0) buckets["Current"] += amt;
          else if (daysPastDue <= 30) buckets["1-30"] += amt;
          else if (daysPastDue <= 60) buckets["31-60"] += amt;
          else if (daysPastDue <= 90) buckets["61-90"] += amt;
          else buckets["90+"] += amt;
        } else buckets["Current"] += amt;

        let predictedDate;
        let predictionMethod = "Default";
        let predictionDetail = statsData.globalAvg + "d global avg";

        if (customDateRaw) {
          predictedDate = parseNsDate(customDateRaw);
          predictionMethod = "Custom";
          predictionDetail = "Expected pay date";
        } else if (statsData.map[entityId]) {
          // Add stdDev buffer to match AR logic for symmetric predictions
          const s = statsData.map[entityId];
          const buffer = s.stdDev ? Math.ceil(s.stdDev * 0.5) : 0;
          predictedDate = addDays(trandate, s.avgDays + buffer);
          predictionMethod = "Statistical";
          predictionDetail = s.avgDays + "d avg + " + buffer + "d buffer";
        } else {
          predictedDate = addDays(trandate, statsData.globalAvg);
        }

        if (predictedDate < timeline.asOfDate) {
          const diffDays = Math.ceil((timeline.asOfDate - predictedDate) / (1000 * 60 * 60 * 24));
          // Use configurable push days with three tiers (matching AR logic)
          let pushDays = pushLight;
          if (diffDays > 60) pushDays = pushHeavy;
          else if (diffDays > 30) pushDays = pushMedium;
          predictedDate = addDays(timeline.asOfDate, pushDays);
          predictionDetail += " (pushed +" + pushDays + "d)";
        }

        predictedDate = adjustToBusinessDay(predictedDate);

        if (predictedDate >= timeline.start && predictedDate <= timeline.end) {
          const wkKey = Core.formatDateForQuery(getWeekStart(predictedDate));
          weeklyMap[wkKey] = (weeklyMap[wkKey] || 0) + amt;
          bills.push({
            internalId: res.id,
            tranId: res.getValue("tranid") || "ID:" + res.id,
            id: res.getValue("tranid") || "ID:" + res.id, // backward compat
            entityId: entityId,
            entityName: entityName,
            entity: entityName, // backward compat
            amount: amt,
            tranDate: Core.formatDateForQuery(trandate),
            dueDate: duedate ? Core.formatDateForQuery(duedate) : "-",
            duedate: duedate ? Core.formatDateForQuery(duedate) : "-", // backward compat
            dueDateObj: duedate || predictedDate,
            predictedDate: Core.formatDateForQuery(predictedDate),
            date: Core.formatDateForQuery(predictedDate), // backward compat
            weekStart: wkKey,
            vendorCat: String(vendorCat || ""),
            isPriority: false,
            daysOverDue: daysOverDue,
            predictionMethod: predictionMethod,
            predictionDetail: predictionDetail,
          });
        }
      });
    });

    // Calculate % current from buckets (based on vendor bills for aging purposes)
    const currentAmountAP = buckets["Current"] || 0;
    const pctCurrentAP = totalOutstanding > 0 ? (currentAmountAP / totalOutstanding) * 100 : 0;

    return {
      summary: {
        outstandingTotal: Core.round2(totalOutstanding),
        totalOutstanding: Core.round2(totalOutstanding),
        avgDaysToPay: statsData.globalAvg,
        avgDaysUsed: statsData.globalAvg,
        pctCurrent: Core.round2(pctCurrentAP),
        buckets: Object.entries(buckets).map(([k, v]) => ({ label: k, amount: Core.round2(v) })),
        bills: bills,
      },
      weeklyMap: weeklyMap,
    };
  }

  function computeAdvancedStats(recordType, paymentHistoryDays, defaultDaysToPay) {
    const today = new Date();
    const historyDays = paymentHistoryDays || 365;
    const defaultDays = defaultDaysToPay || 45;
    const historyStart = addDays(today, -historyDays);
    const type = recordType === "CustInvc" ? search.Type.INVOICE : search.Type.VENDOR_BILL;
    const filters = [
      ["mainline", "is", "T"], "AND",
      ["trandate", "onorafter", toNsDateString(historyStart)], "AND",
      ["closedate", "isnotempty", ""],
    ];
    const columns = ["entity", "trandate", "closedate"];
    const entityData = {};

    try {
      const searchObj = search.create({ type: type, filters: filters, columns: columns });
      const pagedData = searchObj.runPaged({ pageSize: 1000 });
      pagedData.pageRanges.forEach(function (pageRange) {
        const page = pagedData.fetch({ index: pageRange.index });
        page.data.forEach(function (res) {
          const entityId = res.getValue("entity");
          const tranDate = parseNsDate(res.getValue("trandate"));
          const closeDate = parseNsDate(res.getValue("closedate"));
          if (entityId && tranDate && closeDate) {
            const days = (closeDate - tranDate) / (1000 * 60 * 60 * 24);
            if (days >= 0) {
              if (!entityData[entityId]) entityData[entityId] = [];
              entityData[entityId].push(days);
            }
          }
        });
      });
    } catch (e) { log.error("Stats Calc Error", e); }

    const map = {};
    let globalSum = 0;
    let globalCount = 0;

    Object.keys(entityData).forEach((eId) => {
      const points = entityData[eId];
      const n = points.length;
      if (n === 0) return;
      const sum = points.reduce((a, b) => a + b, 0);
      const mean = sum / n;
      const variance = points.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / n;
      const stdDev = Math.sqrt(variance);
      map[eId] = { avgDays: Math.round(mean), stdDev: stdDev, count: n };
      globalSum += sum; globalCount += n;
    });

    const globalAvg = globalCount > 0 ? Math.round(globalSum / globalCount) : defaultDays;
    return { map: map, globalAvg: globalAvg };
  }

  /**
   * Compute AR and AP payment stats in a SINGLE SuiteQL query
   * Replaces two separate computeAdvancedStats calls with one database round-trip
   * @param {number} paymentHistoryDays - Days of history to analyze
   * @param {number} defaultDaysToPay - Default days if no history exists
   * @returns {Object} { ar: {map, globalAvg}, ap: {map, globalAvg} }
   */
  function computeCombinedStats(paymentHistoryDays, defaultDaysToPay) {
    const historyDays = paymentHistoryDays || 365;
    const defaultDays = defaultDaysToPay || 45;
    const today = new Date();
    const historyStart = addDays(today, -historyDays);
    const startStr = Core.formatDateForQuery(historyStart);

    // Single SuiteQL query for both AR (CustInvc) and AP (VendBill) payment history
    // Use explicit aliases to ensure consistent column names in results
    // Use UPPER() for case-insensitive type matching
    // Note: Transaction table is header-level, no mainline filter needed (that's for TransactionLine)
    const sql = `
      SELECT
        UPPER(t.type) AS type,
        t.entity AS entity,
        t.trandate AS trandate,
        t.closedate AS closedate
      FROM Transaction t
      WHERE UPPER(t.type) IN ('CUSTINVC', 'VENDBILL')
        AND t.trandate >= TO_DATE('${startStr}', 'YYYY-MM-DD')
        AND t.closedate IS NOT NULL
    `;

    // Data structures for AR and AP
    const arEntityData = {};
    const apEntityData = {};

    // Helper to parse SuiteQL dates (can be Date objects or strings)
    function parseSuiteQLDate(val) {
      if (!val) return null;
      if (val instanceof Date) return val;
      // Try NetSuite format first, then fallback to standard Date parsing
      try {
        return parseNsDate(val);
      } catch (e) {
        const d = new Date(val);
        return isNaN(d.getTime()) ? null : d;
      }
    }

    try {
      const resultSet = query.runSuiteQL({ query: sql });
      const results = resultSet.asMappedResults();

      results.forEach(function(row) {
        // Skip rows with null/undefined entity
        if (row.entity == null) return;

        const entityId = String(row.entity);
        const tranDate = parseSuiteQLDate(row.trandate);
        const closeDate = parseSuiteQLDate(row.closedate);

        if (tranDate && closeDate) {
          const days = (closeDate - tranDate) / (1000 * 60 * 60 * 24);
          if (days >= 0) {
            // Route to AR or AP based on type (already uppercase from SQL)
            if (row.type === 'CUSTINVC') {
              if (!arEntityData[entityId]) arEntityData[entityId] = [];
              arEntityData[entityId].push(days);
            } else if (row.type === 'VENDBILL') {
              if (!apEntityData[entityId]) apEntityData[entityId] = [];
              apEntityData[entityId].push(days);
            }
          }
        }
      });
    } catch (e) {
      log.error("Combined Stats SuiteQL Error", e);
      // Fallback to empty results - forecasts will use defaults
    }

    // Helper to compute stats from entity data
    function computeStatsFromData(entityData) {
      const map = {};
      let globalSum = 0;
      let globalCount = 0;

      Object.keys(entityData).forEach(function(eId) {
        const points = entityData[eId];
        const n = points.length;
        if (n === 0) return;
        const sum = points.reduce(function(a, b) { return a + b; }, 0);
        const mean = sum / n;
        const variance = points.reduce(function(a, b) { return a + Math.pow(b - mean, 2); }, 0) / n;
        const stdDev = Math.sqrt(variance);
        map[eId] = { avgDays: Math.round(mean), stdDev: stdDev, count: n };
        globalSum += sum;
        globalCount += n;
      });

      const globalAvg = globalCount > 0 ? Math.round(globalSum / globalCount) : defaultDays;
      return { map: map, globalAvg: globalAvg };
    }

    return {
      ar: computeStatsFromData(arEntityData),
      ap: computeStatsFromData(apEntityData)
    };
  }

  function buildFinalTimeline(timeline, startCash, arMap, apBillsList, dynIn, dynOut, apConfig) {
    const weeks = [];
    let runningCash = startCash;
    let totalIn = 0, totalOut = 0;
    let curr = new Date(timeline.start);

    const weeklyCap = parseFloat(apConfig ? apConfig.weeklyCap : 0) || 0;
    const priorityCats = apConfig && apConfig.priorityVendorCategories ? apConfig.priorityVendorCategories : [];
    const restrictToSafe = apConfig && apConfig.restrictToSafe === true;

    const billsByWeek = {};
    apBillsList.forEach((b) => {
      if (!billsByWeek[b.weekStart]) billsByWeek[b.weekStart] = [];
      b.isPriority = priorityCats.includes(b.vendorCat);
      billsByWeek[b.weekStart].push(b);
    });

    let billBacklog = [];
    const scheduledBills = [];

    while (curr <= timeline.end) {
      const k = Core.formatDateForQuery(curr);
      const end = addDays(curr, 6);
      const inAR = arMap[k] || 0;
      const inDyn = dynIn[k] || 0;
      const weekTotalIn = inAR + inDyn;
      const outDyn = dynOut[k] || 0;
      const availableCash = runningCash + weekTotalIn - outDyn;
      const safeApCapacity = availableCash > 0 ? availableCash : 0;
      let effectiveCap = weeklyCap > 0 ? weeklyCap : Number.MAX_SAFE_INTEGER;
      if (restrictToSafe && safeApCapacity < effectiveCap) effectiveCap = safeApCapacity;

      if (billsByWeek[k]) billBacklog.push(...billsByWeek[k]);
      billBacklog.sort((a, b) => {
        if (a.isPriority !== b.isPriority) return b.isPriority - a.isPriority;
        const dateA = new Date(a.dueDateObj);
        const dateB = new Date(b.dueDateObj);
        if (dateA - dateB !== 0) return dateA - dateB;
        return b.amount - a.amount;
      });

      let apPaidThisWeek = 0;
      const nextBacklog = [];

      billBacklog.forEach((bill) => {
        if (apPaidThisWeek + bill.amount <= effectiveCap) {
          apPaidThisWeek += bill.amount;
          // Store original predicted week before setting scheduled week
          bill.originalWeekStart = bill.originalWeekStart || bill.weekStart;
          bill.scheduledWeek = k;
          bill.weekStart = k; // Keep for backward compatibility
          scheduledBills.push(bill);
        } else {
          nextBacklog.push(bill);
        }
      });

      billBacklog = nextBacklog;
      const weekTotalOut = apPaidThisWeek + outDyn;
      const net = weekTotalIn - weekTotalOut;
      const deferredTotal = billBacklog.reduce((sum, b) => sum + b.amount, 0);

      weeks.push({
        weekStart: k, weekEnd: Core.formatDateForQuery(end),
        startingCash: Core.round2(runningCash), safeApCapacity: Core.round2(safeApCapacity),
        inflows: { ar: Core.round2(inAR), other: Core.round2(inDyn), total: Core.round2(weekTotalIn) },
        outflows: { ap: Core.round2(apPaidThisWeek), other: Core.round2(outDyn), total: Core.round2(weekTotalOut), deferred: Core.round2(deferredTotal) },
        netChange: Core.round2(net), endingCash: Core.round2(runningCash + net),
      });

      runningCash += net;
      totalIn += weekTotalIn;
      totalOut += weekTotalOut;
      curr = addDays(curr, 7);
    }

    return {
      weeks: weeks, scheduledBills: scheduledBills,
      summary: {
        startingCash: Core.round2(startCash), projectedEnd: Core.round2(runningCash),
        totalInflows: Core.round2(totalIn), totalOutflows: Core.round2(totalOut),
        netChange: Core.round2(totalIn - totalOut),
      },
    };
  }

  function getProrationFactor(weekStartDate, asOfDate, expectedDayConfig, expectedWeekConfig) {
    const wStart = new Date(weekStartDate);
    const now = new Date(asOfDate);
    wStart.setHours(0, 0, 0, 0); now.setHours(0, 0, 0, 0);
    let targetDate = new Date(wStart);
    let isSpecificDay = false;

    if (expectedDayConfig !== null && expectedDayConfig !== undefined && expectedDayConfig !== "") {
      isSpecificDay = true;
      const currentDayOfWeek = wStart.getDay();
      const targetDayOfWeek = parseInt(expectedDayConfig);
      const distance = targetDayOfWeek - currentDayOfWeek;
      targetDate.setDate(wStart.getDate() + distance);
    }

    if (expectedWeekConfig && expectedWeekConfig !== "") {
      const dayOfMonth = targetDate.getDate();
      const targetWk = parseInt(expectedWeekConfig);
      const actualWk = Math.ceil(dayOfMonth / 7);
      const isMatch = (targetWk === 4 && dayOfMonth >= 22) || targetWk === actualWk;
      if (!isMatch) return 0.0;
    }

    if (isSpecificDay) {
      if (targetDate < now) return 0.0;
      return 1.0;
    }

    if (expectedWeekConfig && expectedWeekConfig !== "") {
      const weekEnd = addDays(wStart, 6);
      if (weekEnd < now) return 0.0;
      return 1.0;
    }

    if (wStart > now) return 1.0;

    const weekEnd = addDays(wStart, 6);
    let businessDaysTotal = 5;
    let businessDaysRemaining = 0;
    let loopDate = new Date(now);
    if (loopDate > weekEnd) return 0.0;
    if (loopDate < wStart) loopDate = new Date(wStart);

    while (loopDate <= weekEnd) {
      const day = loopDate.getDay();
      if (day >= 1 && day <= 5) businessDaysRemaining++;
      loopDate.setDate(loopDate.getDate() + 1);
    }
    let factor = businessDaysRemaining / businessDaysTotal;
    return Math.min(Math.max(factor, 0), 1.0);
  }

  function adjustToBusinessDay(dateObj) {
    if (!dateObj) return null;
    const d = new Date(dateObj);
    const day = d.getDay();
    if (day === 6) d.setDate(d.getDate() + 2);
    else if (day === 0) d.setDate(d.getDate() + 1);
    return d;
  }
  
  function calculateTimeline(weeks) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const start = getWeekStart(today);
    const end = addDays(start, weeks * 7 - 1);
    const days = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;
    return { asOfDate: today, start: start, end: end, days: days };
  }
  
  function computeBankBalance(accountIds) {
    const filters = [["isinactive", "is", "F"]];
    if (accountIds && accountIds.length > 0) filters.push("AND", ["internalid", "anyof", accountIds]);
    else filters.push("AND", ["type", "anyof", "Bank"]);
    let bal = 0;
    search.create({
        type: search.Type.ACCOUNT,
        filters: filters,
        columns: [search.createColumn({ name: "balance", summary: search.Summary.SUM })],
      }).run().each((res) => {
        bal = parseFloat(res.getValue({ name: "balance", summary: search.Summary.SUM })) || 0;
        return true;
      });
    return { balance: bal };
  }

  function getWeekStart(d) {
    const date = new Date(d); const day = date.getDay();
    const diff = date.getDate() - day; return new Date(date.setDate(diff));
  }
  
  function addDays(d, days) { const date = new Date(d); date.setDate(date.getDate() + days); return date; }
  function addMonths(d, months) { const date = new Date(d); date.setMonth(date.getMonth() + months); return date; }
  
  function toNsDateString(d) { return format.format({ value: d, type: format.Type.DATE }); }
  function parseNsDate(str) { return format.parse({ value: str, type: format.Type.DATE }); }

  // ═══════════════════════════════════════════════════════════════════════════
  // LAZY-LOAD SUBACTIONS - Flyout Data Fetchers
  // These provide on-demand drilldown data using EXACT same prediction logic as main query
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get transactions for a specific week - uses SAME calculation path as main getData
   * This ensures flyout data matches the weekly table exactly
   */
  function getWeekTransactions(context) {
    const weekStart = context.weekStart;
    const type = context.type || 'ar'; // 'ar' or 'ap'

    if (!weekStart) {
      return { status: 'error', error: 'weekStart is required' };
    }

    // Get config - SAME as main getData
    const storedConfig = ConfigLib.getStoredConfiguration('cashflow');
    const predictionSettings = storedConfig.predictionSettings || {};
    const volatilityThresholds = predictionSettings.volatilityThresholds || { stable: 5, volatile: 15 };
    const overduePushDays = predictionSettings.overduePushDays || { light: 7, medium: 14, heavy: 28 };
    const paymentHistoryDays = predictionSettings.paymentHistoryDays || 365;
    const defaultDaysToPay = predictionSettings.defaultDaysToPay || 45;

    const stableThreshold = volatilityThresholds.stable || 5;
    const volatileThreshold = volatilityThresholds.volatile || 15;

    // Calculate timeline - SAME as main getData
    const horizonWeeks = storedConfig.horizonWeeks || 8;
    const timeline = calculateTimeline(horizonWeeks);

    // Use SAME stats function as main getData (computeCombinedStats, not computeAdvancedStats)
    const combinedStats = computeCombinedStats(paymentHistoryDays, defaultDaysToPay);

    const transactions = [];

    if (type === 'ar') {
      // Use SAME functions as main getData
      const arStats = combinedStats.ar;
      const arData = buildARForecast(timeline, arStats, volatilityThresholds, overduePushDays);

      // Filter invoices to requested week
      arData.summary.invoices.forEach(function(inv) {
        if (inv.weekStart === weekStart) {
          // Add volatility label
          let volLabel = "Avg";
          if (arStats.map[inv.entityId]) {
            if (arStats.map[inv.entityId].stdDev < stableThreshold) volLabel = "Stable";
            else if (arStats.map[inv.entityId].stdDev > volatileThreshold) volLabel = "Volatile";
          }

          transactions.push({
            internalId: inv.internalId,
            tranId: inv.tranId,
            entityId: inv.entityId,
            entityName: inv.entityName,
            amount: inv.amount,
            tranDate: inv.tranDate,
            dueDate: inv.dueDate || "-",
            predictedDate: inv.predictedDate,
            daysOverDue: inv.daysOverDue || 0,
            confidence: volLabel === 'Stable' ? 'high' : volLabel === 'Volatile' ? 'low' : 'medium',
            volatility: volLabel,
            predictionMethod: inv.predictionMethod || 'unknown',
            predictionDetail: inv.predictionDetail || ''
          });
        }
      });
    } else {
      // AP: Use SAME functions as main getData INCLUDING scheduling logic
      const arStats = combinedStats.ar;
      const apStats = combinedStats.ap;

      // Must compute AR forecast because AR inflows affect safeApCapacity in buildFinalTimeline
      const arData = buildARForecast(timeline, arStats, volatilityThresholds, overduePushDays);
      const apData = buildAPForecast(timeline, apStats, storedConfig.apFilters || {}, overduePushDays);

      // Get bank balance for scheduling
      const bank = computeBankBalance(storedConfig.bankAccountIds);

      // Run buildFinalTimeline with SAME inputs as main getData (AR map affects safeApCapacity)
      const weeklyData = buildFinalTimeline(
        timeline,
        bank.balance,
        arData.weeklyMap, // AR inflows affect safeApCapacity calculation
        apData.summary.bills,
        {}, // Dynamic inflows from categories (not available in flyout)
        {}, // Dynamic outflows from categories (not available in flyout)
        storedConfig.apFilters
      );

      // Filter SCHEDULED bills to requested week (these have caps/deferrals applied)
      weeklyData.scheduledBills.forEach(function(bill) {
        if (bill.scheduledWeek === weekStart) {
          transactions.push({
            internalId: bill.internalId,
            tranId: bill.tranId,
            entityId: bill.entityId,
            entityName: bill.entityName,
            amount: bill.amount,
            tranDate: bill.tranDate,
            dueDate: bill.dueDate || "-",
            predictedDate: bill.predictedDate,
            scheduledDate: bill.scheduledWeek, // The ACTUAL scheduled week after caps/deferrals
            originalWeek: bill.weekStart, // Original predicted week before scheduling
            wasDeferred: bill.weekStart !== bill.scheduledWeek,
            daysOverDue: bill.daysOverDue || 0,
            confidence: 'medium',
            vendorCategory: bill.vendorCat,
            isPriority: bill.isPriority || false,
            predictionMethod: bill.predictionMethod || 'unknown',
            predictionDetail: bill.predictionDetail || ''
          });
        }
      });
    }

    // Sort by amount descending
    transactions.sort((a, b) => b.amount - a.amount);

    // Calculate summary stats
    const totalAmount = transactions.reduce((sum, t) => sum + t.amount, 0);
    const avgAmount = transactions.length > 0 ? totalAmount / transactions.length : 0;

    return {
      status: 'success',
      weekStart: weekStart,
      type: type,
      transactions: transactions,
      summary: {
        count: transactions.length,
        totalAmount: Core.round2(totalAmount),
        avgAmount: Core.round2(avgAmount)
      }
    };
  }

  /**
   * Get payment history and trend for a specific customer or vendor
   * Called when user clicks an entity in the flyout
   */
  function getEntityHistory(context) {
    const entityId = context.entityId;
    const entityType = context.entityType || 'customer'; // 'customer' or 'vendor'
    const months = parseInt(context.months) || 12;
    
    if (!entityId) {
      return { status: 'error', error: 'entityId is required' };
    }
    
    const historyStart = addMonths(new Date(), -months);
    const payments = [];
    const monthlyTotals = {};
    
    if (entityType === 'customer') {
      // Get closed invoices for this customer
      const searchObj = search.create({
        type: search.Type.INVOICE,
        filters: [
          ["mainline", "is", "T"], "AND",
          ["entity", "anyof", entityId], "AND",
          ["closedate", "isnotempty", ""], "AND",
          ["closedate", "onorafter", toNsDateString(historyStart)]
        ],
        columns: [
          "internalid", "tranid", "amount", "trandate", "closedate", "status", "memo"
        ]
      });
      
      let totalDays = 0;
      let count = 0;
      
      const pagedData = searchObj.runPaged({ pageSize: 1000 });
      pagedData.pageRanges.forEach(function(pageRange) {
        const page = pagedData.fetch({ index: pageRange.index });
        page.data.forEach(function(res) {
          const trandate = parseNsDate(res.getValue("trandate"));
          const closedate = parseNsDate(res.getValue("closedate"));
          const amount = parseFloat(res.getValue("amount")) || 0;
          const daysToPay = Math.ceil((closedate - trandate) / (1000 * 60 * 60 * 24));
          
          const monthKey = closedate.getFullYear() + '-' + String(closedate.getMonth() + 1).padStart(2, '0');
          monthlyTotals[monthKey] = (monthlyTotals[monthKey] || 0) + amount;
          
          totalDays += daysToPay;
          count++;
          
          payments.push({
            internalId: res.getValue("internalid"),
            tranId: res.getValue("tranid"),
            amount: amount,
            tranDate: Core.formatDateForQuery(trandate),
            closeDate: Core.formatDateForQuery(closedate),
            daysToPay: daysToPay,
            memo: res.getValue("memo") || ''
          });
        });
      });
      
      // Get open invoices
      const openSearch = search.create({
        type: search.Type.INVOICE,
        filters: [
          ["mainline", "is", "T"], "AND",
          ["entity", "anyof", entityId], "AND",
          ["amountremaining", "greaterthan", 0], "AND",
          ["status", "noneof", "CustInvc:V"]
        ],
        columns: [
          "internalid", "tranid", "amountremaining", "trandate", "duedate", "memo"
        ]
      });
      
      const openInvoices = [];
      openSearch.run().each(function(res) {
        const duedate = res.getValue("duedate") ? parseNsDate(res.getValue("duedate")) : null;
        const today = new Date();
        let daysOverDue = 0;
        if (duedate) {
          daysOverDue = Math.ceil((today - duedate) / (1000 * 60 * 60 * 24));
        }
        
        openInvoices.push({
          internalId: res.getValue("internalid"),
          tranId: res.getValue("tranid"),
          amount: parseFloat(res.getValue("amountremaining")) || 0,
          tranDate: Core.formatDateForQuery(parseNsDate(res.getValue("trandate"))),
          dueDate: duedate ? Core.formatDateForQuery(duedate) : null,
          daysOverDue: daysOverDue,
          memo: res.getValue("memo") || ''
        });
        return true;
      });
      
      const avgDaysToPay = count > 0 ? Math.round(totalDays / count) : 0;
      const totalOpen = openInvoices.reduce((sum, i) => sum + i.amount, 0);
      
      // Calculate payment reliability score (0-100)
      // Based on: avg days to pay vs terms, consistency, overdue ratio
      let reliabilityScore = 70; // Base score
      if (avgDaysToPay <= 30) reliabilityScore += 20;
      else if (avgDaysToPay <= 45) reliabilityScore += 10;
      else if (avgDaysToPay > 60) reliabilityScore -= 20;
      
      const overdueCount = openInvoices.filter(i => i.daysOverDue > 0).length;
      if (overdueCount === 0) reliabilityScore += 10;
      else if (overdueCount > openInvoices.length / 2) reliabilityScore -= 15;
      
      reliabilityScore = Math.max(0, Math.min(100, reliabilityScore));
      
      return {
        status: 'success',
        entityId: entityId,
        entityType: entityType,
        summary: {
          avgDaysToPay: avgDaysToPay,
          totalPaid: Core.round2(payments.reduce((sum, p) => sum + p.amount, 0)),
          paymentCount: count,
          openCount: openInvoices.length,
          totalOpen: Core.round2(totalOpen),
          reliabilityScore: reliabilityScore
        },
        monthlyTrend: Object.entries(monthlyTotals)
          .map(([month, amount]) => ({ month, amount: Core.round2(amount) }))
          .sort((a, b) => a.month.localeCompare(b.month)),
        recentPayments: payments.slice(0, 20),
        openItems: openInvoices
      };
      
    } else {
      // Vendor payment history
      const searchObj = search.create({
        type: search.Type.TRANSACTION,
        filters: [
          ["mainline", "is", "T"], "AND",
          ["type", "anyof", "VendPymt", "Check"], "AND",
          ["entity", "anyof", entityId], "AND",
          ["trandate", "onorafter", toNsDateString(historyStart)]
        ],
        columns: [
          "internalid", "tranid", "amount", "trandate", "type", "memo"
        ]
      });
      
      const pagedData = searchObj.runPaged({ pageSize: 1000 });
      pagedData.pageRanges.forEach(function(pageRange) {
        const page = pagedData.fetch({ index: pageRange.index });
        page.data.forEach(function(res) {
          const trandate = parseNsDate(res.getValue("trandate"));
          const amount = Math.abs(parseFloat(res.getValue("amount")) || 0);
          
          const monthKey = trandate.getFullYear() + '-' + String(trandate.getMonth() + 1).padStart(2, '0');
          monthlyTotals[monthKey] = (monthlyTotals[monthKey] || 0) + amount;
          
          payments.push({
            internalId: res.getValue("internalid"),
            tranId: res.getValue("tranid"),
            amount: amount,
            tranDate: Core.formatDateForQuery(trandate),
            type: res.getText("type"),
            memo: res.getValue("memo") || ''
          });
        });
      });
      
      // Get open bills
      const openSearch = search.create({
        type: search.Type.VENDOR_BILL,
        filters: [
          ["mainline", "is", "T"], "AND",
          ["entity", "anyof", entityId], "AND",
          ["amountremaining", "greaterthan", 0]
        ],
        columns: [
          "internalid", "tranid", "amountremaining", "trandate", "duedate", "memo"
        ]
      });
      
      const openBills = [];
      openSearch.run().each(function(res) {
        const duedate = res.getValue("duedate") ? parseNsDate(res.getValue("duedate")) : null;
        const today = new Date();
        let daysOverDue = 0;
        if (duedate) {
          daysOverDue = Math.ceil((today - duedate) / (1000 * 60 * 60 * 24));
        }
        
        openBills.push({
          internalId: res.getValue("internalid"),
          tranId: res.getValue("tranid"),
          amount: parseFloat(res.getValue("amountremaining")) || 0,
          tranDate: Core.formatDateForQuery(parseNsDate(res.getValue("trandate"))),
          dueDate: duedate ? Core.formatDateForQuery(duedate) : null,
          daysOverDue: daysOverDue,
          memo: res.getValue("memo") || ''
        });
        return true;
      });
      
      const totalOpen = openBills.reduce((sum, b) => sum + b.amount, 0);
      const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);
      const avgPayment = payments.length > 0 ? totalPaid / payments.length : 0;
      
      return {
        status: 'success',
        entityId: entityId,
        entityType: entityType,
        summary: {
          totalPaid: Core.round2(totalPaid),
          paymentCount: payments.length,
          avgPayment: Core.round2(avgPayment),
          openCount: openBills.length,
          totalOpen: Core.round2(totalOpen)
        },
        monthlyTrend: Object.entries(monthlyTotals)
          .map(([month, amount]) => ({ month, amount: Core.round2(amount) }))
          .sort((a, b) => a.month.localeCompare(b.month)),
        recentPayments: payments.slice(0, 20),
        openItems: openBills
      };
    }
  }

  /**
   * Get all items in a specific aging bucket
   * Called when user clicks an aging bucket bar
   */
  function getAgingBucketDetail(context) {
    const bucket = context.bucket; // 'Current', '1-30', '31-60', '61-90', '90+'
    const type = context.type || 'ar'; // 'ar' or 'ap'
    
    if (!bucket) {
      return { status: 'error', error: 'bucket is required' };
    }
    
    const today = new Date();
    const items = [];
    
    // Determine date filters based on bucket
    let minDaysOverdue = 0;
    let maxDaysOverdue = 0;
    
    switch (bucket) {
      case 'Current':
        minDaysOverdue = -999999;
        maxDaysOverdue = 0;
        break;
      case '1-30':
        minDaysOverdue = 1;
        maxDaysOverdue = 30;
        break;
      case '31-60':
        minDaysOverdue = 31;
        maxDaysOverdue = 60;
        break;
      case '61-90':
        minDaysOverdue = 61;
        maxDaysOverdue = 90;
        break;
      case '90+':
        minDaysOverdue = 91;
        maxDaysOverdue = 999999;
        break;
      default:
        return { status: 'error', error: 'Invalid bucket' };
    }
    
    if (type === 'ar') {
      const searchObj = search.create({
        type: search.Type.INVOICE,
        filters: [
          ["mainline", "is", "T"], "AND",
          ["amountremaining", "greaterthan", 0], "AND",
          ["status", "noneof", "CustInvc:V"]
        ],
        columns: [
          "internalid", "tranid", "entity", "amountremaining",
          "trandate", "duedate", "daysoverdue"
        ]
      });

      // Use runPaged to handle >4000 results
      const pagedData = searchObj.runPaged({ pageSize: 1000 });
      pagedData.pageRanges.forEach(function(pageRange) {
        pagedData.fetch({ index: pageRange.index }).data.forEach(function(res) {
          const duedate = res.getValue("duedate") ? parseNsDate(res.getValue("duedate")) : null;
          let daysOverDue = 0;

          if (duedate) {
            daysOverDue = Math.ceil((today - duedate) / (1000 * 60 * 60 * 24));
          }

          // Check if falls in requested bucket
          if (daysOverDue >= minDaysOverdue && daysOverDue <= maxDaysOverdue) {
            items.push({
              internalId: res.getValue("internalid"),
              tranId: res.getValue("tranid"),
              entityId: res.getValue("entity"),
              entityName: res.getText("entity"),
              amount: parseFloat(res.getValue("amountremaining")) || 0,
              tranDate: Core.formatDateForQuery(parseNsDate(res.getValue("trandate"))),
              dueDate: duedate ? Core.formatDateForQuery(duedate) : null,
              predictedDate: duedate ? Core.formatDateForQuery(duedate) : "-",
              daysOverDue: daysOverDue,
              predictionMethod: "DueDate",
              predictionDetail: "Based on invoice due date"
            });
          }
        });
      });
    } else {
      const searchObj = search.create({
        type: search.Type.VENDOR_BILL,
        filters: [
          ["mainline", "is", "T"], "AND",
          ["amountremaining", "greaterthan", 0]
        ],
        columns: [
          "internalid", "tranid", "entity", "amountremaining",
          "trandate", "duedate"
        ]
      });

      // Use runPaged to handle >4000 results
      const pagedData = searchObj.runPaged({ pageSize: 1000 });
      pagedData.pageRanges.forEach(function(pageRange) {
        pagedData.fetch({ index: pageRange.index }).data.forEach(function(res) {
          const duedate = res.getValue("duedate") ? parseNsDate(res.getValue("duedate")) : null;
          let daysOverDue = 0;

          if (duedate) {
            daysOverDue = Math.ceil((today - duedate) / (1000 * 60 * 60 * 24));
          }

          if (daysOverDue >= minDaysOverdue && daysOverDue <= maxDaysOverdue) {
            items.push({
              internalId: res.getValue("internalid"),
              tranId: res.getValue("tranid"),
              entityId: res.getValue("entity"),
              entityName: res.getText("entity"),
              amount: parseFloat(res.getValue("amountremaining")) || 0,
              tranDate: Core.formatDateForQuery(parseNsDate(res.getValue("trandate"))),
              dueDate: duedate ? Core.formatDateForQuery(duedate) : null,
              predictedDate: duedate ? Core.formatDateForQuery(duedate) : "-",
              daysOverDue: daysOverDue,
              predictionMethod: "DueDate",
              predictionDetail: "Based on bill due date"
            });
          }
        });
      });
    }

    // Sort by amount descending
    items.sort((a, b) => b.amount - a.amount);
    
    const totalAmount = items.reduce((sum, i) => sum + i.amount, 0);
    
    return {
      status: 'success',
      bucket: bucket,
      type: type,
      items: items,
      summary: {
        count: items.length,
        totalAmount: Core.round2(totalAmount)
      }
    };
  }

  return { 
    getData,
    getWeekTransactions,
    getEntityHistory,
    getAgingBucketDetail,
    
    /**
     * Handle POST requests with subActions for lazy-loaded flyout data
     */
    handleRequest: function(context) {
      const subAction = context.subAction;
      
      switch (subAction) {
        case 'week_transactions':
          return getWeekTransactions(context);
          
        case 'entity_history':
          return getEntityHistory(context);
          
        case 'aging_bucket_detail':
          return getAgingBucketDetail(context);
          
        default:
          // No subAction - return main dashboard data
          return getData(context);
      }
    }
  };
});