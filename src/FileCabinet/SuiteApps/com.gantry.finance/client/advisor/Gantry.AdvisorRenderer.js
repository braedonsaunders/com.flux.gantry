/**
 * Gantry.AdvisorRenderer.js
 * Rich content rendering for Advisor responses
 *
 * Handles:
 * - Markdown to HTML conversion
 * - Enhanced table rendering (standard, grouped, financial statement)
 * - Chart rendering via Plotly
 * - Metric cards
 * - Warning/Success alerts
 * - Code blocks with syntax highlighting
 * - PivotTable.js integration (lazy-loaded)
 */
(function (window) {
  "use strict";

  // Table data store for pivot functionality
  const _tableData = {};

  // Track loaded libraries
  let _pivotLibLoaded = false;
  let _pivotLibLoading = false;

  const AdvisorRenderer = {
    /**
     * Convert markdown-like text to HTML
     */
    renderMarkdown(text) {
      if (!text) return "";

      let html = text;

      // Escape HTML first
      html = html
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

      // Bold **text**
      html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

      // Italic *text*
      html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");

      // Inline code `code`
      html = html.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');

      // Headers
      html = html.replace(/^### (.+)$/gm, "<h5>$1</h5>");
      html = html.replace(/^## (.+)$/gm, "<h4>$1</h4>");
      html = html.replace(/^# (.+)$/gm, "<h3>$1</h3>");

      // Bullet points
      html = html.replace(/^[•\-\*] (.+)$/gm, "<li>$1</li>");
      html = html.replace(/(<li>.*<\/li>\n?)+/g, "<ul>$&</ul>");

      // Numbered lists
      html = html.replace(/^\d+\. (.+)$/gm, "<li>$1</li>");

      // Line breaks
      html = html.replace(/\n\n/g, "</p><p>");
      html = html.replace(/\n/g, "<br>");

      // Wrap in paragraph if not already structured
      if (!html.startsWith("<")) {
        html = "<p>" + html + "</p>";
      }

      return html;
    },

    /**
     * Render rich content component
     */
    renderRichContent(item) {
      if (!item || !item.type) return "";

      switch (item.type) {
        case "table":
          return this.renderTable(item);
        case "chart":
          return this.renderChart(item);
        case "metric":
          return this.renderMetric(item);
        case "metrics":
          return this.renderMetricsGroup(item);
        case "warning":
          return this.renderAlert(item, "warning");
        case "success":
          return this.renderAlert(item, "success");
        case "info":
          return this.renderAlert(item, "info");
        case "code":
          return this.renderCode(item);
        default:
          console.warn("[AdvisorRenderer] Unknown content type:", item.type);
          return "";
      }
    },

    // ═══════════════════════════════════════════════════════════════════
    // ENHANCED TABLE RENDERING
    // ═══════════════════════════════════════════════════════════════════

    /**
     * Main table renderer - routes to appropriate variant
     */
    renderTable(item) {
            const { columns, rows } = item;
            
            if (!columns || !rows || rows.length === 0) {
                return '<div class="advisor-table-empty">No data available</div>';
            }
            
            const tableId = 'advisor-table-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
            
            _tableData[tableId] = { columns, rows, item };
            
            // Check for auto-pivot
            if (item.pivotConfig?.enabled) {
                const pivotedItem = this.transformToPivot(item);
                if (pivotedItem) item = pivotedItem;
            }
            
            const variant = item.variant || (item.groupBy ? 'grouped' : 'standard');
            const isFinancialStatement = ['income_statement', 'balance_sheet', 'financial_statement'].includes(variant);
            
            let tableHtml;
            switch (variant) {
                case 'income_statement': tableHtml = this.renderIncomeStatement(tableId, item); break;
                case 'balance_sheet': tableHtml = this.renderBalanceSheet(tableId, item); break;
                case 'financial_statement': tableHtml = this.renderFinancialStatement(tableId, item); break;
                case 'grouped': tableHtml = this.renderGroupedTable(tableId, item); break;
                default: tableHtml = this.renderStandardTable(tableId, item);
            }
            
            // Double-click the CONTAINER to trigger focus mode
            return `
                <div class="advisor-table-container" id="${tableId}-container" ondblclick="AdvisorRenderer.toggleFocus('${tableId}')">
                    ${isFinancialStatement ? '' : this.renderTableToolbar(tableId, item.title)}
                    <div class="advisor-table-wrapper" id="${tableId}-table">
                        ${tableHtml}
                    </div>
                    ${isFinancialStatement ? '' : `<div class="advisor-pivot-wrapper" id="${tableId}-pivot" style="display: none;"></div>`}
                    ${item.footer ? `<div class="advisor-table-footer">${this.escapeHtml(item.footer)}</div>` : ''}
                </div>
            `;
        },

    /**
     * Transform data to pivot format based on pivotConfig
     * Converts rows into columns (e.g., departments become column headers)
     */
    transformToPivot(item) {
            const { pivotConfig, rows, columns, calculatedTotals } = item;
            if (!pivotConfig || !rows || rows.length === 0) return null;

            // 1. Handle Pre-Pivoted Data (API)
            if (pivotConfig.prePivoted) {
                const formatting = {};
                if (item.formatting) {
                    Object.keys(item.formatting).forEach(key => {
                        formatting[this.normalizeKey(key)] = item.formatting[key];
                    });
                }
                return {
                    ...item,
                    formatting: formatting,
                    variant: ['income_statement', 'balance_sheet'].includes(item.variant) ? item.variant : 'standard',
                    groupBy: item.groupBy,
                    pivotConfig: null
                };
            }

            // 2. Client-Side Pivot Logic
            const { rowField, columnField, valueField, showTotalColumn } = pivotConfig;
            if (!rowField || !columnField || !valueField) return null;
            
            const normalizeKey = (key) => key.toLowerCase().replace(/[\s_]+/g, '_');
            const getRowValue = (row, field) => {
                const normalField = normalizeKey(field);
                for (const key of Object.keys(row)) {
                    if (normalizeKey(key) === normalField) return row[key];
                }
                return null;
            };
            
            const columnValues = new Set();
            rows.forEach(row => {
                const colVal = getRowValue(row, columnField);
                if (colVal) columnValues.add(colVal);
            });
            const sortedColumnValues = Array.from(columnValues).sort();
            
            const rowMap = new Map(); 
            rows.forEach(row => {
                const rowVal = getRowValue(row, rowField);
                const colVal = getRowValue(row, columnField);
                const amount = getRowValue(row, valueField) || 0;
                if (!rowMap.has(rowVal)) rowMap.set(rowVal, {});
                rowMap.get(rowVal)[colVal] = amount;
            });
            
            const pivotedColumns = [rowField.charAt(0).toUpperCase() + rowField.slice(1)];
            sortedColumnValues.forEach(cv => pivotedColumns.push(cv));
            if (showTotalColumn) pivotedColumns.push('Total');
            
            const pivotedRows = [];
            const sectionTotals = {}; 
            
            for (const [rowVal, colAmounts] of rowMap) {
                const pivotedRow = {};
                pivotedRow[rowField] = rowVal;
                
                const originalRow = rows.find(r => getRowValue(r, rowField) === rowVal);
                if (originalRow) {
                    Object.keys(originalRow).forEach(k => {
                        if (normalizeKey(k) !== normalizeKey(columnField) && 
                            normalizeKey(k) !== normalizeKey(valueField)) {
                            pivotedRow[k] = originalRow[k];
                        }
                    });
                }
                
                let rowTotal = 0;
                sortedColumnValues.forEach(cv => {
                    const amt = colAmounts[cv] || 0;
                    pivotedRow[cv] = amt;
                    rowTotal += amt;
                });
                
                if (showTotalColumn) pivotedRow['Total'] = rowTotal;
                pivotedRows.push(pivotedRow);
                
                const sectionKey = normalizeKey(rowVal);
                sectionTotals[sectionKey] = {};
                sortedColumnValues.forEach(cv => sectionTotals[sectionKey][cv] = colAmounts[cv] || 0);
                sectionTotals[sectionKey]['Total'] = rowTotal;
            }
            
            const isFinancial = ['income_statement', 'balance_sheet'].includes(item.variant);
            if (!isFinancial && calculatedTotals && calculatedTotals.length > 0) {
                calculatedTotals.forEach(calc => {
                    const calcRow = {};
                    calcRow[rowField] = calc.label;
                    calcRow._isCalculated = true;
                    calcRow._style = calc.style;
                    const allCols = showTotalColumn ? [...sortedColumnValues, 'Total'] : sortedColumnValues;
                    allCols.forEach(cv => {
                        calcRow[cv] = this.evaluatePivotFormula(calc.formula, sectionTotals, cv);
                    });
                    pivotedRows.push(calcRow);
                });
            }
            
            const formatting = {};
            sortedColumnValues.forEach(cv => formatting[this.normalizeKey(cv)] = 'currency');
            if (showTotalColumn) formatting[this.normalizeKey('Total')] = 'currency';
            
            return {
                ...item,
                columns: pivotedColumns,
                rows: pivotedRows,
                formatting: formatting,
                variant: isFinancial ? item.variant : 'standard',
                groupBy: item.groupBy, 
                pivotConfig: null 
            };
        },
    /**
     * Evaluate a formula for a specific column in pivoted data
     */
    evaluatePivotFormula(formula, sectionTotals, columnKey) {
      let result = 0;
      const parts = formula.toLowerCase().split(/\s*\+\s*/);

      parts.forEach((part) => {
        const sectionKey = part.trim();
        if (
          sectionTotals[sectionKey] &&
          typeof sectionTotals[sectionKey][columnKey] === "number"
        ) {
          result += sectionTotals[sectionKey][columnKey];
        }
      });

      return result;
    },

    /**
     * Render table toolbar with copy, CSV, and pivot buttons
     */
    renderTableToolbar(tableId, title) {
      return `
        <div class="table-toolbar">
            <div class="table-toolbar-title">${this.escapeHtml(
              title || "Results"
            )}</div>
            <div class="table-toolbar-actions">
                <button class="table-tool-btn" data-table="${tableId}" data-action="copy" title="Copy to clipboard" onclick="AdvisorRenderer.copyTable('${tableId}')">
                    <i class="fas fa-copy"></i>
                </button>
                <button class="table-tool-btn" data-table="${tableId}" data-action="csv" title="Download CSV" onclick="AdvisorRenderer.exportCSV('${tableId}')">
                    <i class="fas fa-file-csv"></i>
                </button>
                <button class="table-tool-btn" data-table="${tableId}" data-action="pivot" title="Pivot table" onclick="AdvisorRenderer.togglePivot('${tableId}')">
                    <i class="fas fa-table"></i>
                </button>
                
                <button class="table-tool-btn" data-table="${tableId}" data-action="focus" title="Toggle Focus Mode" onclick="AdvisorRenderer.toggleFocus('${tableId}')">
                    <i class="fas fa-expand"></i>
                </button>
            </div>
        </div>
    `;
    },

    /**
     * Default row limit for standard tables (before "Show more" button)
     */
    DEFAULT_ROW_LIMIT: 25,

    /**
     * Render standard flat table with row limiting
     */
    renderStandardTable(tableId, item) {
      const {
        columns,
        rows,
        formatting,
        align,
        showGrandTotal,
        grandTotalLabel,
      } = item;

      // Determine row limit - can be overridden per table
      const rowLimit =
        item.rowLimit !== undefined ? item.rowLimit : this.DEFAULT_ROW_LIMIT;
      const totalRows = rows.length;
      const hasHiddenRows = totalRows > rowLimit;

      let html = '<table class="advisor-table">';

      // Header
      html += "<thead><tr>";
      columns.forEach((col) => {
        const colKey = this.normalizeKey(col);
        const alignment = align?.[colKey] || "left";
        html += `<th style="text-align: ${alignment}">${this.escapeHtml(
          col
        )}</th>`;
      });
      html += "</tr></thead>";

      // Body
      html += "<tbody>";

      // Track totals for grand total row (calculate from ALL rows, not just visible)
      const totals = {};

      rows.forEach((row, rowIdx) => {
        // Check for calculated rows from pivot transformation
        const isCalculated = row._isCalculated;
        const rowStyle = row._style;
        const rowClass = isCalculated
          ? `calculated-total-row ${rowStyle === "grand" ? "grand" : ""}`
          : "";

        // Determine if this row should be hidden initially
        const isHidden = hasHiddenRows && rowIdx >= rowLimit && !isCalculated;
        const hiddenStyle = isHidden ? 'style="display: none;"' : "";
        const hiddenAttr = isHidden ? `data-table-hidden="${tableId}"` : "";

        html += `<tr class="${rowClass}" ${hiddenStyle} ${hiddenAttr}>`;
        columns.forEach((col, idx) => {
          const colKey = this.normalizeKey(col);
          const value = this.getRowValue(row, col);
          const format = formatting?.[colKey];
          const alignment =
            align?.[colKey] || (typeof value === "number" ? "right" : "left");

          // Accumulate for totals (skip calculated rows) - count ALL rows for accurate totals
          if (typeof value === "number" && !isCalculated) {
            totals[colKey] = (totals[colKey] || 0) + value;
          }

          // First column of calculated rows gets bold styling (no links for calculated rows)
          if (isCalculated && idx === 0) {
            html += `<td style="text-align: ${alignment}; font-weight: 600;">${this.formatValue(
              value,
              format
            )}</td>`;
          } else if (isCalculated) {
            html += `<td style="text-align: ${alignment}; font-weight: 600;">${this.formatValue(
              value,
              format
            )}</td>`;
          } else {
            // Regular data rows - use formatCellWithLink for deep linking
            html += `<td style="text-align: ${alignment}">${this.formatCellWithLink(
              value,
              format,
              colKey,
              row,
              columns
            )}</td>`;
          }
        });
        html += "</tr>";
      });

      // Grand total row (only if no calculated rows exist)
      const hasCalculatedRows = rows.some((r) => r._isCalculated);
      if (
        showGrandTotal &&
        !hasCalculatedRows &&
        Object.keys(totals).length > 0
      ) {
        html += '<tr class="grand-total-row">';
        columns.forEach((col, idx) => {
          const colKey = this.normalizeKey(col);
          if (idx === 0) {
            html += `<td><strong>${grandTotalLabel || "Total"}</strong></td>`;
          } else if (totals[colKey] !== undefined) {
            const format = formatting?.[colKey];
            html += `<td style="text-align: right"><strong>${this.formatValue(
              totals[colKey],
              format
            )}</strong></td>`;
          } else {
            html += "<td></td>";
          }
        });
        html += "</tr>";
      }

      html += "</tbody></table>";

      // Add "Show more" button if there are hidden rows
      if (hasHiddenRows) {
        const hiddenCount = totalRows - rowLimit;
        html += `
                    <div class="table-expand-row" id="${tableId}-expand" style="text-align: center; padding: 8px 0; border-top: 1px solid #e2e8f0;">
                        <button class="table-show-more" onclick="AdvisorRenderer.expandTable('${tableId}', ${totalRows})">
                            <i class="fas fa-chevron-down"></i>
                            <span>Show ${hiddenCount} more row${
          hiddenCount > 1 ? "s" : ""
        }</span>
                        </button>
                        <span class="table-row-info" style="margin-left: 12px; font-size: 11px; color: #64748b;">Showing ${rowLimit} of ${totalRows}</span>
                    </div>
                `;
      }

      return html;
    },

    /**
     * Render grouped table with collapsible sections and subtotals
     *
     * Supports calculatedTotals for P&L-style computed rows (e.g., Gross Profit, Net Income)
     * instead of naive sum of all numeric values.
     *
     * calculatedTotals: [
     *   { id: "gross_profit", label: "Gross Profit", formula: "income + cogs", style: "subtotal" },
     *   { id: "net_income", label: "Net Income", formula: "income + cogs + expenses", style: "grand" }
     * ]
     *
     * Section IDs are derived from normalized group names (e.g., "Income" -> "income")
     */
    renderGroupedTable(tableId, item) {
      const {
        columns,
        rows,
        groupBy,
        formatting,
        align,
        showSubtotals,
        subtotalColumns,
        hideGroupColumn,
        showGrandTotal,
        grandTotalLabel,
        calculatedTotals,
      } = item;

      // Default to collapsed unless explicitly set to false
      const startCollapsed = item.startCollapsed !== false;

      // Group rows by the groupBy column
      const groups = this.groupRows(rows, groupBy);
      const groupByKey = this.normalizeKey(groupBy);

      // Determine visible columns (optionally hide group column)
      const visibleColumns = hideGroupColumn
        ? columns.filter((c) => this.normalizeKey(c) !== groupByKey)
        : columns;

      // Find ALL numeric columns for multi-column totals
      const numericColumns = this.findNumericColumns(columns, rows, formatting);

      let html = '<table class="advisor-table grouped-table">';

      // Header
      html += "<thead><tr>";
      visibleColumns.forEach((col) => {
        const colKey = this.normalizeKey(col);
        const alignment = align?.[colKey] || "left";
        html += `<th style="text-align: ${alignment}">${this.escapeHtml(
          col
        )}</th>`;
      });
      html += "</tr></thead>";

      html += "<tbody>";

      // Grand totals accumulator (for naive grand total)
      const grandTotals = {};

      // Section totals for calculated rows - now stores ALL numeric columns
      // Format: { sectionId: { col1: val, col2: val, ... }, ... }
      const sectionTotals = {};

      // Render each group
      Object.keys(groups).forEach((groupValue, groupIdx) => {
        const groupRows = groups[groupValue];
        const groupId = `${tableId}-group-${groupIdx}`;
        const collapsedClass = startCollapsed ? "collapsed" : "";
        const sectionId = this.normalizeKey(groupValue);

        // Group header row
        html += `<tr class="group-header ${collapsedClass}" data-group="${groupId}" onclick="AdvisorRenderer.toggleGroup('${groupId}')">`;
        html += `<td colspan="${
          visibleColumns.length
        }" style="text-align: left">
                    <i class="fas fa-chevron-down chevron"></i>
                    <span class="group-header-label">${this.escapeHtml(
                      groupValue
                    )}</span>
                    <span class="group-count">(${groupRows.length})</span>
                </td>`;
        html += "</tr>";

        // Group rows
        const groupTotals = {};
        html += `<tbody class="group-rows" id="${groupId}" ${
          startCollapsed ? 'style="display:none"' : ""
        }>`;

        groupRows.forEach((row) => {
          html += '<tr class="group-data-row">';
          visibleColumns.forEach((col) => {
            const colKey = this.normalizeKey(col);
            const value = this.getRowValue(row, col);
            const format = formatting?.[colKey];
            const alignment =
              align?.[colKey] || (typeof value === "number" ? "right" : "left");

            // Accumulate totals for ALL numeric columns
            if (typeof value === "number") {
              groupTotals[colKey] = (groupTotals[colKey] || 0) + value;
              grandTotals[colKey] = (grandTotals[colKey] || 0) + value;
            }

            // Use formatCellWithLink for deep linking to transactions/entities
            html += `<td style="text-align: ${alignment}">${this.formatCellWithLink(
              value,
              format,
              colKey,
              row,
              columns
            )}</td>`;
          });
          html += "</tr>";
        });

        // Store ALL numeric column totals for this section
        sectionTotals[sectionId] = { ...groupTotals };

        // Subtotal row
        if (showSubtotals) {
          html += '<tr class="subtotal-row">';
          visibleColumns.forEach((col, idx) => {
            const colKey = this.normalizeKey(col);
            const shouldSubtotal =
              !subtotalColumns ||
              subtotalColumns.includes(colKey) ||
              subtotalColumns.includes(col);

            if (idx === 0) {
              html += `<td><em>Subtotal</em></td>`;
            } else if (groupTotals[colKey] !== undefined && shouldSubtotal) {
              const format = formatting?.[colKey];
              html += `<td style="text-align: right"><em>${this.formatValue(
                groupTotals[colKey],
                format
              )}</em></td>`;
            } else {
              html += "<td></td>";
            }
          });
          html += "</tr>";
        }

        html += "</tbody>";
      });

      // Calculated totals with MULTI-COLUMN support
      if (calculatedTotals && calculatedTotals.length > 0) {
        calculatedTotals.forEach((calcRow) => {
          const styleClass =
            calcRow.style === "grand"
              ? "calculated-total-row grand"
              : "calculated-total-row";

          html += `<tr class="${styleClass}">`;
          visibleColumns.forEach((col, idx) => {
            const colKey = this.normalizeKey(col);
            const isNumeric = numericColumns.includes(colKey);

            if (idx === 0) {
              html += `<td style="text-align: left"><strong>${this.escapeHtml(
                calcRow.label
              )}</strong></td>`;
            } else if (isNumeric) {
              // Evaluate formula for THIS specific column
              const calcValue = this.evaluateFormulaForColumn(
                calcRow.formula,
                sectionTotals,
                colKey
              );
              const format = formatting?.[colKey] || "currency";
              html += `<td style="text-align: right"><strong>${this.formatValue(
                calcValue,
                format
              )}</strong></td>`;
            } else {
              html += "<td></td>";
            }
          });
          html += "</tr>";
        });
      } else if (showGrandTotal && Object.keys(grandTotals).length > 0) {
        // Naive grand total (only if no calculatedTotals provided)
        html += '<tr class="grand-total-row">';
        visibleColumns.forEach((col, idx) => {
          const colKey = this.normalizeKey(col);
          if (idx === 0) {
            html += `<td style="text-align: left"><strong>${
              grandTotalLabel || "Grand Total"
            }</strong></td>`;
          } else if (grandTotals[colKey] !== undefined) {
            const format = formatting?.[colKey];
            html += `<td style="text-align: right"><strong>${this.formatValue(
              grandTotals[colKey],
              format
            )}</strong></td>`;
          } else {
            html += "<td></td>";
          }
        });
        html += "</tr>";
      }

      html += "</tbody></table>";

      return html;
    },

    /**
     * Render financial statement (Income Statement, Balance Sheet)
     */
    renderFinancialStatement(tableId, item) {
      const {
        columns,
        rows,
        groupBy,
        sections,
        calculatedRows,
        formatting,
        align,
        hideGroupColumn,
      } = item;

      const groupByKey = this.normalizeKey(groupBy);

      // Determine visible columns
      const visibleColumns = hideGroupColumn
        ? columns.filter((c) => this.normalizeKey(c) !== groupByKey)
        : columns;

      // Find amount column (typically last numeric column)
      const amountColKey = this.findAmountColumn(columns, rows, formatting);

      let html = '<table class="advisor-table financial-statement">';

      // Header
      html += "<thead><tr>";
      visibleColumns.forEach((col) => {
        const colKey = this.normalizeKey(col);
        const alignment =
          align?.[colKey] || (colKey === amountColKey ? "right" : "left");
        html += `<th style="text-align: ${alignment}">${this.escapeHtml(
          col
        )}</th>`;
      });
      html += "</tr></thead>";

      html += "<tbody>";

      // Track section totals for calculated rows
      const sectionTotals = {};

      // Render each section
      (sections || []).forEach((section, sectionIdx) => {
        const sectionId = `${tableId}-section-${sectionIdx}`;

        // Get rows matching this section
        const sectionRows = rows.filter((row) => {
          const groupValue = this.getRowValue(row, groupBy);
          return (
            groupValue === section.matchValue ||
            (groupValue &&
              groupValue.toLowerCase() === section.matchValue?.toLowerCase())
          );
        });

        // Calculate section total
        let sectionTotal = 0;
        sectionRows.forEach((row) => {
          const amt = this.getRowValue(row, amountColKey) || 0;
          sectionTotal += typeof amt === "number" ? amt : parseFloat(amt) || 0;
        });
        sectionTotals[section.id] = sectionTotal * (section.sign || 1);

        // Section header
        html += `<tr class="fs-section-header" data-section="${sectionId}" onclick="AdvisorRenderer.toggleGroup('${sectionId}')">`;
        html += `<td colspan="${visibleColumns.length}">
                    <i class="fas fa-chevron-down chevron"></i>
                    ${this.escapeHtml(section.label)}
                </td>`;
        html += "</tr>";

        // Section rows
        html += `<tbody class="fs-section-rows" id="${sectionId}">`;
        sectionRows.forEach((row) => {
          html += '<tr class="fs-account-row">';
          visibleColumns.forEach((col) => {
            const colKey = this.normalizeKey(col);
            let value = this.getRowValue(row, col);
            const format = formatting?.[colKey];
            const alignment =
              align?.[colKey] || (colKey === amountColKey ? "right" : "left");

            // Apply sign for display (expenses in parentheses)
            const isNegative =
              section.sign === -1 &&
              colKey === amountColKey &&
              typeof value === "number";

            let displayValue = this.formatValue(value, format);
            if (isNegative && value > 0) {
              displayValue = `<span class="fs-negative">${this.formatCurrencyAbs(
                value
              )}</span>`;
            }

            html += `<td style="text-align: ${alignment}">${displayValue}</td>`;
          });
          html += "</tr>";
        });

        // Section subtotal
        html += '<tr class="fs-section-subtotal">';
        visibleColumns.forEach((col, idx) => {
          const colKey = this.normalizeKey(col);
          if (idx === visibleColumns.length - 1 || colKey === amountColKey) {
            const displayTotal =
              section.sign === -1 && sectionTotal > 0
                ? `<span class="fs-negative">${this.formatCurrencyAbs(
                    sectionTotal
                  )}</span>`
                : this.formatValue(sectionTotal, "currency");
            html += `<td style="text-align: right">${displayTotal}</td>`;
          } else if (idx === 0) {
            html += `<td style="padding-left: 24px"><em>Total ${section.label}</em></td>`;
          } else {
            html += "<td></td>";
          }
        });
        html += "</tr>";
        html += "</tbody>";

        // Insert calculated row after this section if specified
        (calculatedRows || []).forEach((calcRow) => {
          if (calcRow.afterSection === section.id) {
            const calcValue = this.evaluateFormula(
              calcRow.formula,
              sectionTotals
            );
            const styleClass =
              calcRow.style === "grand"
                ? "fs-calculated-row grand"
                : "fs-calculated-row";

            html += `<tr class="${styleClass}">`;
            visibleColumns.forEach((col, idx) => {
              const colKey = this.normalizeKey(col);
              if (
                idx === visibleColumns.length - 1 ||
                colKey === amountColKey
              ) {
                html += `<td style="text-align: right"><strong>${this.formatValue(
                  calcValue,
                  "currency"
                )}</strong></td>`;
              } else if (idx === 0) {
                html += `<td><strong>${this.escapeHtml(
                  calcRow.label
                )}</strong></td>`;
              } else {
                html += "<td></td>";
              }
            });
            html += "</tr>";
          }
        });
      });

      html += "</tbody></table>";

      return html;
    },

    // ═══════════════════════════════════════════════════════════════════
    // INCOME STATEMENT VARIANT
    // Professional P&L with auto-detected sections and multi-column totals
    // ═══════════════════════════════════════════════════════════════════

    /**
     * Render Income Statement with professional formatting
     * Auto-detects sections from account_type column
     * Supports multiple numeric columns (current, prior, variance)
     */
    renderIncomeStatement(tableId, item) {
      const {
        columns,
        rows,
        groupBy,
        formatting,
        calculatedTotals,
        title,
        reportHeader,
      } = item;

      // Determine which column contains the account type for grouping
      const groupByCol = groupBy || "account_type";
      const groupByKey = this.normalizeKey(groupByCol);

      // Find all numeric columns (for multi-column totals)
      const numericColumns = this.findNumericColumns(columns, rows, formatting);

      // Define income statement sections in order
      const sectionConfig = [
        { id: "income", match: ["income"], label: "Revenue", sign: 1 },
        {
          id: "othincome",
          match: ["othincome", "other_income", "otherincome"],
          label: "Other Income",
          sign: 1,
        },
        {
          id: "cogs",
          match: ["cogs", "cost_of_goods_sold"],
          label: "Cost of Goods Sold",
          sign: 1,
        },
        {
          id: "expense",
          match: ["expense", "expenses"],
          label: "Operating Expenses",
          sign: 1,
        },
        {
          id: "othexpense",
          match: ["othexpense", "other_expense", "otherexpense"],
          label: "Other Expenses",
          sign: 1,
        },
      ];

      // Group rows by account type
      const groupedRows = {};
      rows.forEach((row) => {
        const groupValue = this.getRowValue(row, groupByCol);
        const normalizedGroup = this.normalizeKey(groupValue || "other");
        if (!groupedRows[normalizedGroup]) {
          groupedRows[normalizedGroup] = [];
        }
        groupedRows[normalizedGroup].push(row);
      });

      // Determine visible columns (hide the group column)
      const visibleColumns = columns.filter(
        (c) => this.normalizeKey(c) !== groupByKey
      );

      // Calculate section totals for each numeric column
      const sectionTotals = {}; // { sectionId: { col1: val, col2: val, ... } }

      let html = '<div class="financial-statement-container">';
            if (item.reportHeader !== false) {
                html += this.renderStatementHeader(item.title || 'Income Statement', item.dateRange, tableId);
            }
            html += `<table class="advisor-table income-statement" id="${tableId}">`;

      // Column headers
      html += "<thead><tr>";
      visibleColumns.forEach((col, idx) => {
        const colKey = this.normalizeKey(col);
        const isNumeric = numericColumns.includes(colKey);
        const alignment = isNumeric ? "right" : "left";
        // Clean up column names for display
        const displayName = this.formatColumnHeader(col);
        html += `<th style="text-align: ${alignment}">${this.escapeHtml(
          displayName
        )}</th>`;
      });
      html += "</tr></thead>";

      html += "<tbody>";

      // Check if Other Expense data exists (for Net Income placement)
      const hasOtherExpenses = Object.keys(groupedRows).some((key) =>
        ["othexpense", "other_expense", "otherexpense"].some((m) =>
          key.includes(m)
        )
      );

      // Track which calculated rows have been inserted
      const insertedCalcs = new Set();

      // Render each section
      sectionConfig.forEach((section, sectionIdx) => {
        // Find matching rows for this section
        const matchingKeys = Object.keys(groupedRows).filter((key) =>
          section.match.some((m) => key.includes(m))
        );

        if (matchingKeys.length === 0) return; // Skip empty sections

        const sectionRows = matchingKeys.flatMap(
          (key) => groupedRows[key] || []
        );
        if (sectionRows.length === 0) return;

        const sectionId = `${tableId}-section-${section.id}`;

        // Initialize section totals
        sectionTotals[section.id] = {};
        numericColumns.forEach((col) => {
          sectionTotals[section.id][col] = 0;
        });

        // Section header
        html += `<tr class="fs-section-header" data-section="${sectionId}" onclick="AdvisorRenderer.toggleGroup('${sectionId}')">`;
        html += `<td colspan="${visibleColumns.length}">
                    <i class="fas fa-chevron-down chevron"></i>
                    <span class="fs-section-label">${section.label}</span>
                </td>`;
        html += "</tr>";

        // Section rows
        html += `<tbody class="fs-section-rows" id="${sectionId}">`;
        sectionRows.forEach((row) => {
          html += '<tr class="fs-account-row">';
          visibleColumns.forEach((col) => {
            const colKey = this.normalizeKey(col);
            const value = this.getRowValue(row, col);
            const isNumeric = numericColumns.includes(colKey);
            const alignment = isNumeric ? "right" : "left";

            // Accumulate section totals
            if (isNumeric && typeof value === "number") {
              sectionTotals[section.id][colKey] += value;
            }

            // Format value
            let displayValue;
            if (isNumeric) {
              displayValue = this.formatFinancialValue(value);
            } else {
              displayValue = this.escapeHtml(String(value || ""));
            }

            html += `<td style="text-align: ${alignment}">${displayValue}</td>`;
          });
          html += "</tr>";
        });
        html += "</tbody>";

        // Section subtotal
        html += '<tr class="fs-section-subtotal">';
        visibleColumns.forEach((col, idx) => {
          const colKey = this.normalizeKey(col);
          const isNumeric = numericColumns.includes(colKey);

          if (idx === 0) {
            html += `<td class="fs-subtotal-label">Total ${section.label}</td>`;
          } else if (isNumeric) {
            const total = sectionTotals[section.id][colKey] || 0;
            html += `<td style="text-align: right">${this.formatFinancialValue(
              total
            )}</td>`;
          } else {
            html += "<td></td>";
          }
        });
        html += "</tr>";

        // Insert calculated row after this section if specified
        if (calculatedTotals) {
          const calcsAfterThis = calculatedTotals.filter((calc) => {
            // Insert Gross Profit after COGS
            if (calc.id === "gross_profit" && section.id === "cogs")
              return true;
            // Insert Net Income after Other Expenses (if they exist)
            if (calc.id === "net_income" && section.id === "othexpense")
              return true;
            // Insert Net Income after Expenses if no Other Expenses exist
            if (
              calc.id === "net_income" &&
              section.id === "expense" &&
              !hasOtherExpenses
            )
              return true;
            return false;
          });

          calcsAfterThis.forEach((calc) => {
            html += this.renderCalculatedRow(
              calc,
              sectionTotals,
              visibleColumns,
              numericColumns
            );
            insertedCalcs.add(calc.id);
          });
        }
      });

      // Add any calculated rows that weren't inserted (e.g., if COGS section was empty)
      if (calculatedTotals && calculatedTotals.length > 0) {
        calculatedTotals.forEach((calc) => {
          if (!insertedCalcs.has(calc.id)) {
            html += this.renderCalculatedRow(
              calc,
              sectionTotals,
              visibleColumns,
              numericColumns
            );
          }
        });
      }

      html += "</tbody></table>";
      html += "</div>";

      return html;
    },

    /**
     * Render a calculated total row (Gross Profit, Net Income) with multi-column support
     */
    renderCalculatedRow(calc, sectionTotals, visibleColumns, numericColumns) {
      const styleClass =
        calc.style === "grand"
          ? "fs-calculated-row grand"
          : "fs-calculated-row";

      let html = `<tr class="${styleClass}">`;
      visibleColumns.forEach((col, idx) => {
        const colKey = this.normalizeKey(col);
        const isNumeric = numericColumns.includes(colKey);

        if (idx === 0) {
          html += `<td class="fs-calc-label">${this.escapeHtml(
            calc.label
          )}</td>`;
        } else if (isNumeric) {
          // Evaluate formula for this specific column
          const value = this.evaluateFormulaForColumn(
            calc.formula,
            sectionTotals,
            colKey
          );
          html += `<td style="text-align: right">${this.formatFinancialValue(
            value
          )}</td>`;
        } else {
          html += "<td></td>";
        }
      });
      html += "</tr>";

      return html;
    },

    /**
     * Evaluate formula for a specific column
     * sectionTotals format: { sectionId: { colKey: value, ... }, ... }
     */
    evaluateFormulaForColumn(formula, sectionTotals, colKey) {
      if (!formula) return 0;

      let result = 0;
      const parts = formula.split(/\s*([+\-])\s*/);
      let currentOp = "+";

      parts.forEach((part) => {
        part = part
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9_]/g, "");
        if (part === "" || part === "+" || part === "-") {
          if (part === "+" || part === "-") currentOp = part;
          return;
        }

        // Look up the section total for this column
        const sectionData = sectionTotals[part];
        if (sectionData && sectionData[colKey] !== undefined) {
          if (currentOp === "+") {
            result += sectionData[colKey];
          } else {
            result -= sectionData[colKey];
          }
        }
      });

      return result;
    },

    // ═══════════════════════════════════════════════════════════════════
    // BALANCE SHEET VARIANT
    // ═══════════════════════════════════════════════════════════════════

    /**
     * Render Balance Sheet with professional formatting
     * Auto-detects sections from account_type or category column
     */
    renderBalanceSheet(tableId, item) {
      const { columns, rows, groupBy, formatting, title, reportHeader } = item;

      const groupByCol = groupBy || "category";
      const groupByKey = this.normalizeKey(groupByCol);

      // Find all numeric columns
      const numericColumns = this.findNumericColumns(columns, rows, formatting);

      // Define balance sheet sections
      const sectionConfig = [
        {
          id: "assets",
          match: ["assets", "asset", "bank", "acctrec", "fixedasset"],
          label: "Assets",
          sign: 1,
        },
        {
          id: "liabilities",
          match: ["liabilities", "liability", "acctpay", "credcard"],
          label: "Liabilities",
          sign: 1,
        },
        {
          id: "equity",
          match: ["equity", "retainearn", "retained"],
          label: "Equity",
          sign: 1,
        },
      ];

      // Group rows
      const groupedRows = {};
      rows.forEach((row) => {
        const groupValue = this.getRowValue(row, groupByCol);
        const normalizedGroup = this.normalizeKey(groupValue || "other");
        if (!groupedRows[normalizedGroup]) {
          groupedRows[normalizedGroup] = [];
        }
        groupedRows[normalizedGroup].push(row);
      });

      const visibleColumns = columns.filter(
        (c) => this.normalizeKey(c) !== groupByKey
      );
      const sectionTotals = {};

      let html = '<div class="financial-statement-container">';
            if (item.reportHeader !== false) {
                html += this.renderStatementHeader(item.title || 'Balance Sheet', item.dateRange, tableId);
            }

      html += `<table class="advisor-table balance-sheet" id="${tableId}">`;

      // Headers
      html += "<thead><tr>";
      visibleColumns.forEach((col, idx) => {
        const colKey = this.normalizeKey(col);
        const isNumeric = numericColumns.includes(colKey);
        const displayName = this.formatColumnHeader(col);
        html += `<th style="text-align: ${
          isNumeric ? "right" : "left"
        }">${this.escapeHtml(displayName)}</th>`;
      });
      html += "</tr></thead>";

      html += "<tbody>";

      // Render sections
      sectionConfig.forEach((section) => {
        const matchingKeys = Object.keys(groupedRows).filter((key) =>
          section.match.some((m) => key.includes(m))
        );

        if (matchingKeys.length === 0) return;

        const sectionRows = matchingKeys.flatMap(
          (key) => groupedRows[key] || []
        );
        if (sectionRows.length === 0) return;

        const sectionId = `${tableId}-section-${section.id}`;

        sectionTotals[section.id] = {};
        numericColumns.forEach((col) => {
          sectionTotals[section.id][col] = 0;
        });

        // Section header
        html += `<tr class="fs-section-header" data-section="${sectionId}" onclick="AdvisorRenderer.toggleGroup('${sectionId}')">`;
        html += `<td colspan="${visibleColumns.length}">
                    <i class="fas fa-chevron-down chevron"></i>
                    <span class="fs-section-label">${section.label}</span>
                </td>`;
        html += "</tr>";

        // Rows
        html += `<tbody class="fs-section-rows" id="${sectionId}">`;
        sectionRows.forEach((row) => {
          html += '<tr class="fs-account-row">';
          visibleColumns.forEach((col) => {
            const colKey = this.normalizeKey(col);
            const value = this.getRowValue(row, col);
            const isNumeric = numericColumns.includes(colKey);

            if (isNumeric && typeof value === "number") {
              sectionTotals[section.id][colKey] += value;
            }

            const displayValue = isNumeric
              ? this.formatFinancialValue(value)
              : this.escapeHtml(String(value || ""));

            html += `<td style="text-align: ${
              isNumeric ? "right" : "left"
            }">${displayValue}</td>`;
          });
          html += "</tr>";
        });
        html += "</tbody>";

        // Subtotal
        html += '<tr class="fs-section-subtotal">';
        visibleColumns.forEach((col, idx) => {
          const colKey = this.normalizeKey(col);
          const isNumeric = numericColumns.includes(colKey);

          if (idx === 0) {
            html += `<td class="fs-subtotal-label">Total ${section.label}</td>`;
          } else if (isNumeric) {
            const total = sectionTotals[section.id][colKey] || 0;
            html += `<td style="text-align: right">${this.formatFinancialValue(
              total
            )}</td>`;
          } else {
            html += "<td></td>";
          }
        });
        html += "</tr>";
      });

      // Total Liabilities + Equity row
      if (sectionTotals["liabilities"] || sectionTotals["equity"]) {
        html += '<tr class="fs-calculated-row grand">';
        visibleColumns.forEach((col, idx) => {
          const colKey = this.normalizeKey(col);
          const isNumeric = numericColumns.includes(colKey);

          if (idx === 0) {
            html += '<td class="fs-calc-label">Total Liabilities & Equity</td>';
          } else if (isNumeric) {
            const liab =
              (sectionTotals["liabilities"] &&
                sectionTotals["liabilities"][colKey]) ||
              0;
            const eq =
              (sectionTotals["equity"] && sectionTotals["equity"][colKey]) || 0;
            html += `<td style="text-align: right">${this.formatFinancialValue(
              liab + eq
            )}</td>`;
          } else {
            html += "<td></td>";
          }
        });
        html += "</tr>";
      }

      html += "</tbody></table>";
      html += "</div>";

      return html;
    },

    // ═══════════════════════════════════════════════════════════════════
    // FINANCIAL STATEMENT HELPERS
    // ═══════════════════════════════════════════════════════════════════

    /**
     * Render statement header with company name and date range
     */
    renderStatementHeader(title, dateRange, tableId) {
            // Note: Added tableId to params to link the button
            let html = '<div class="fs-header">';
            
            // Add the Expand Button here for visibility
            html += `
                <button class="fs-expand-btn" onclick="AdvisorRenderer.toggleFocus('${tableId}')" title="Expand View">
                    <i class="fas fa-expand"></i>
                </button>
            `;
            
            html += `<div class="fs-title">${this.escapeHtml(title)}</div>`;
            if (dateRange) {
                html += `<div class="fs-date-range">${this.escapeHtml(dateRange)}</div>`;
            }
            html += '</div>';
            return html;
        },

    /**
     * Format column header for display (clean up snake_case, etc.)
     */
    formatColumnHeader(col) {
      if (!col) return "";
      return col
        .replace(/_/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase())
        .replace(/Ytd/g, "YTD")
        .replace(/Yoy/g, "YoY");
    },

    /**
     * Find all numeric columns in the data
     */
    findNumericColumns(columns, rows, formatting) {
      const numericCols = [];

      // Check formatting hints first
      if (formatting) {
        Object.entries(formatting).forEach(([key, fmt]) => {
          if (fmt === "currency" || fmt === "number") {
            numericCols.push(key);
          }
        });
      }

      // Also check actual data
      if (rows.length > 0) {
        columns.forEach((col) => {
          const colKey = this.normalizeKey(col);
          if (!numericCols.includes(colKey)) {
            const value = this.getRowValue(rows[0], col);
            if (typeof value === "number") {
              numericCols.push(colKey);
            }
          }
        });
      }

      return numericCols;
    },

    /**
     * Format value for financial statements (parentheses for negatives)
     */
    formatFinancialValue(value) {
      if (value === null || value === undefined) return "—";
      if (typeof value !== "number") value = parseFloat(value) || 0;

      const absValue = Math.abs(value);
      let formatted;

      // Format with thousands separators, no decimals for large numbers
      if (absValue >= 1000000) {
        formatted = "$" + (absValue / 1000000).toFixed(1) + "M";
      } else {
        formatted =
          "$" +
          absValue.toLocaleString("en-US", {
            minimumFractionDigits: 0,
            maximumFractionDigits: 0,
          });
      }

      // Parentheses for negatives (accounting format)
      if (value < 0) {
        return `<span class="fs-negative">(${formatted})</span>`;
      }

      return formatted;
    },

    // ═══════════════════════════════════════════════════════════════════
    // TABLE UTILITIES
    // ═══════════════════════════════════════════════════════════════════

    /**
     * Group rows by a column value
     */
    groupRows(rows, groupBy) {
      const groups = {};
      const groupByKey = this.normalizeKey(groupBy);

      rows.forEach((row) => {
        const groupValue = this.getRowValue(row, groupBy) || "Other";
        if (!groups[groupValue]) {
          groups[groupValue] = [];
        }
        groups[groupValue].push(row);
      });

      return groups;
    },

    /**
     * Get value from row (handles both object keys and column names)
     */
    getRowValue(row, column) {
      if (Array.isArray(row)) {
        // Array row - need column index, not supported in this context
        return row[0];
      }

      // Try exact match first
      if (row[column] !== undefined) return row[column];

      // Try normalized key
      const normalizedKey = this.normalizeKey(column);
      if (row[normalizedKey] !== undefined) return row[normalizedKey];

      // Try case-insensitive match
      const lowerCol = column.toLowerCase();
      for (const key of Object.keys(row)) {
        if (
          key.toLowerCase() === lowerCol ||
          this.normalizeKey(key) === normalizedKey
        ) {
          return row[key];
        }
      }

      return undefined;
    },

    /**
     * Normalize column name to key format
     */
    normalizeKey(column) {
      if (!column) return "";
      return column
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "_")
        .replace(/_+/g, "_");
    },

    /**
     * Find the amount/value column in the data
     */
    findAmountColumn(columns, rows, formatting) {
      // Check formatting hints
      if (formatting) {
        for (const [key, fmt] of Object.entries(formatting)) {
          if (fmt === "currency") return key;
        }
      }

      // Look for common amount column names
      const amountPatterns = ["amount", "total", "value", "balance", "sum"];
      for (const col of columns) {
        const colKey = this.normalizeKey(col);
        if (amountPatterns.some((p) => colKey.includes(p))) {
          return colKey;
        }
      }

      // Fallback: last numeric column
      if (rows.length > 0) {
        const row = rows[0];
        for (let i = columns.length - 1; i >= 0; i--) {
          const val = this.getRowValue(row, columns[i]);
          if (typeof val === "number") {
            return this.normalizeKey(columns[i]);
          }
        }
      }

      return null;
    },

    /**
     * Evaluate formula using section totals
     */
    evaluateFormula(formula, sectionTotals) {
      if (!formula) return 0;

      // Parse formula like "revenue + cogs + expenses"
      let result = 0;
      const parts = formula.split(/\s*([+\-])\s*/);
      let currentOp = "+";

      parts.forEach((part) => {
        part = part.trim();
        if (part === "+" || part === "-") {
          currentOp = part;
        } else if (sectionTotals[part] !== undefined) {
          if (currentOp === "+") {
            result += sectionTotals[part];
          } else {
            result -= sectionTotals[part];
          }
        }
      });

      return result;
    },

    /**
     * Toggle group expand/collapse
     */
    toggleGroup(groupId) {
      const groupRows = document.getElementById(groupId);
      const header = document.querySelector(
        `[data-group="${groupId}"], [data-section="${groupId}"]`
      );

      if (groupRows && header) {
        const isCollapsed = header.classList.contains("collapsed");

        if (isCollapsed) {
          header.classList.remove("collapsed");
          groupRows.style.display = "";
        } else {
          header.classList.add("collapsed");
          groupRows.style.display = "none";
        }
      }
    },

    /**
     * Expand table to show all hidden rows
     */
    expandTable(tableId, totalRows) {
      // Find all hidden rows for this table
      const hiddenRows = document.querySelectorAll(
        `[data-table-hidden="${tableId}"]`
      );

      hiddenRows.forEach((row) => {
        row.style.display = ""; // Show the row
        row.removeAttribute("data-table-hidden");
      });

      // Hide the expand button container
      const expandContainer = document.getElementById(`${tableId}-expand`);
      if (expandContainer) {
        expandContainer.style.display = "none";
      }

      // Add a collapse button
      const tableContainer = document.getElementById(`${tableId}-container`);
      if (tableContainer && !document.getElementById(`${tableId}-collapse`)) {
        const collapseHtml = `
                    <div class="table-expand-row" id="${tableId}-collapse" style="text-align: center; padding: 8px 0; border-top: 1px solid #e2e8f0;">
                        <button class="table-show-more" onclick="AdvisorRenderer.collapseTable('${tableId}', ${this.DEFAULT_ROW_LIMIT}, ${totalRows})">
                            <i class="fas fa-chevron-up"></i>
                            <span>Show less</span>
                        </button>
                        <span class="table-row-info" style="margin-left: 12px; font-size: 11px; color: #64748b;">Showing all ${totalRows} rows</span>
                    </div>
                `;
        // Insert after the table wrapper
        const tableWrapper = document.getElementById(`${tableId}-table`);
        if (tableWrapper) {
          tableWrapper.insertAdjacentHTML("afterend", collapseHtml);
        }
      }
    },

    /**
     * Collapse table back to limited rows
     */
    collapseTable(tableId, rowLimit, totalRows) {
      // Find all data rows in this table
      const tableWrapper = document.getElementById(`${tableId}-table`);
      if (!tableWrapper) return;

      const table = tableWrapper.querySelector("table.advisor-table");
      if (!table) return;

      const rows = table.querySelectorAll(
        "tbody > tr:not(.grand-total-row):not(.calculated-total-row)"
      );

      rows.forEach((row, idx) => {
        if (idx >= rowLimit) {
          row.style.display = "none"; // Hide the row
          row.setAttribute("data-table-hidden", tableId);
        }
      });

      // Show the expand button again
      const expandContainer = document.getElementById(`${tableId}-expand`);
      if (expandContainer) {
        expandContainer.style.display = "";
      }

      // Remove the collapse button
      const collapseContainer = document.getElementById(`${tableId}-collapse`);
      if (collapseContainer) {
        collapseContainer.remove();
      }

      // Scroll table into view
      tableWrapper.scrollIntoView({ behavior: "smooth", block: "nearest" });
    },

    // ═══════════════════════════════════════════════════════════════════
    // PIVOT TABLE INTEGRATION
    // ═══════════════════════════════════════════════════════════════════

    /**
     * Toggle between table and pivot view
     */
    async togglePivot(tableId) {
      const tableWrapper = document.getElementById(`${tableId}-table`);
      const pivotWrapper = document.getElementById(`${tableId}-pivot`);
      const pivotBtn = document.querySelector(
        `[data-table="${tableId}"][data-action="pivot"]`
      );

      if (!tableWrapper || !pivotWrapper) return;

      const isPivotActive = pivotWrapper.style.display !== "none";

      if (isPivotActive) {
        // Switch back to table
        tableWrapper.style.display = "";
        pivotWrapper.style.display = "none";
        if (pivotBtn) pivotBtn.classList.remove("active");
      } else {
        // Switch to pivot
        tableWrapper.style.display = "none";
        pivotWrapper.style.display = "";
        if (pivotBtn) pivotBtn.classList.add("active");

        // Initialize pivot if not done
        if (!pivotWrapper.dataset.initialized) {
          await this.initPivot(tableId);
        }
      }
    },

    /**
     * Initialize pivot table
     */
    async initPivot(tableId) {
      const pivotWrapper = document.getElementById(`${tableId}-pivot`);
      if (!pivotWrapper) return;

      pivotWrapper.innerHTML =
        '<div class="pivot-loading"><i class="fas fa-spinner fa-spin"></i> Loading pivot table...</div>';

      try {
        // Load libraries if needed
        await this.loadPivotLibrary();

        // Get table data
        const tableData = _tableData[tableId];
        if (!tableData) {
          pivotWrapper.innerHTML =
            '<div class="pivot-error">No data available</div>';
          return;
        }

        const { columns, rows } = tableData;

        // Convert to array of objects format for pivot
        const data = rows.map((row) => {
          const obj = {};
          columns.forEach((col) => {
            const value = this.getRowValue(row, col);
            obj[col] = value;
          });
          return obj;
        });

        // Clear and initialize pivot
        pivotWrapper.innerHTML = "";
        jQuery(`#${tableId}-pivot`).pivotUI(data, {
          rows: [],
          cols: [],
          aggregatorName: "Sum",
          vals: [],
          rendererName: "Table",
          renderers: jQuery.extend(
            jQuery.pivotUtilities.renderers,
            jQuery.pivotUtilities.plotly_renderers || {}
          ),
        });

        pivotWrapper.dataset.initialized = "true";
      } catch (err) {
        console.error("[AdvisorRenderer] Pivot init failed:", err);
        pivotWrapper.innerHTML =
          '<div class="pivot-error">Failed to load pivot table. Please try again.</div>';
      }
    },

    /**
     * Lazy-load pivot table library
     */
    async loadPivotLibrary() {
      if (_pivotLibLoaded) return;

      if (_pivotLibLoading) {
        // Wait for existing load to complete
        while (_pivotLibLoading) {
          await new Promise((r) => setTimeout(r, 100));
        }
        return;
      }

      _pivotLibLoading = true;

      try {
        // Load jQuery if not present
        if (typeof jQuery === "undefined") {
          await this.loadScript("https://code.jquery.com/jquery-3.7.1.min.js");
        }

        // Load jQuery UI for drag-drop
        if (!jQuery.ui) {
          await this.loadScript(
            "https://code.jquery.com/ui/1.13.2/jquery-ui.min.js"
          );
        }

        // Load PivotTable CSS
        this.loadCSS(
          "https://cdnjs.cloudflare.com/ajax/libs/pivottable/2.23.0/pivot.min.css"
        );

        // Load PivotTable JS
        await this.loadScript(
          "https://cdnjs.cloudflare.com/ajax/libs/pivottable/2.23.0/pivot.min.js"
        );

        _pivotLibLoaded = true;
      } finally {
        _pivotLibLoading = false;
      }
    },

    /**
     * Load external script
     */
    loadScript(src) {
      return new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = src;
        script.onload = resolve;
        script.onerror = () => reject(new Error(`Failed to load ${src}`));
        document.head.appendChild(script);
      });
    },

    /**
     * Load external CSS
     */
    loadCSS(href) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = href;
      document.head.appendChild(link);
    },

    // ═══════════════════════════════════════════════════════════════════
    // TABLE EXPORT FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════

    /**
     * Copy table to clipboard
     */
    async copyTable(tableId) {
      const tableData = _tableData[tableId];
      if (!tableData) return;

      const { columns, rows } = tableData;

      // Build TSV string
      let tsv = columns.join("\t") + "\n";
      rows.forEach((row) => {
        const values = columns.map((col) => {
          const val = this.getRowValue(row, col);
          return val !== null && val !== undefined ? String(val) : "";
        });
        tsv += values.join("\t") + "\n";
      });

      try {
        await navigator.clipboard.writeText(tsv);
        this.showToast("Table copied to clipboard");
      } catch (err) {
        console.error("Copy failed:", err);
        this.showToast("Failed to copy", "error");
      }
    },

    /**
     * Export table as CSV
     */
    exportCSV(tableId) {
      const tableData = _tableData[tableId];
      if (!tableData) return;

      const { columns, rows, item } = tableData;

      // Build CSV string
      const escapeCSV = (val) => {
        if (val === null || val === undefined) return "";
        const str = String(val);
        if (str.includes(",") || str.includes('"') || str.includes("\n")) {
          return '"' + str.replace(/"/g, '""') + '"';
        }
        return str;
      };

      let csv = columns.map(escapeCSV).join(",") + "\n";
      rows.forEach((row) => {
        const values = columns.map((col) =>
          escapeCSV(this.getRowValue(row, col))
        );
        csv += values.join(",") + "\n";
      });

      // Download
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download =
        (item?.title || "export").replace(/[^a-z0-9]/gi, "_") + ".csv";
      link.click();

      this.showToast("CSV downloaded");
    },

    /**
     * Toggle "Focus Mode" (Zen View) for a table
     */
    toggleFocus(tableId) {
            const container = document.getElementById(`${tableId}-container`);
            if (!container) return;
            
            // Toggle class
            container.classList.toggle('advisor-focus-mode');
            
            // Handle body scrolling and icon state
            const isFocused = container.classList.contains('advisor-focus-mode');
            document.body.style.overflow = isFocused ? 'hidden' : '';
            
            // Toggle icon if present (in toolbar OR financial header)
            const btnIcon = container.querySelector('.fa-expand, .fa-compress');
            if (btnIcon) {
                if (isFocused) {
                    btnIcon.classList.replace('fa-expand', 'fa-compress');
                } else {
                    btnIcon.classList.replace('fa-compress', 'fa-expand');
                }
            }
            
            if(isFocused) this.showToast('Focus Mode Active (Press Esc or Click Icon to Exit)', 'info');
        },

    /**
     * Show toast notification
     */
    showToast(message, type = "success") {
      const toast = document.createElement("div");
      toast.className = `advisor-toast ${type}`;
      toast.textContent = message;
      document.body.appendChild(toast);

      setTimeout(() => toast.classList.add("show"), 10);
      setTimeout(() => {
        toast.classList.remove("show");
        setTimeout(() => toast.remove(), 300);
      }, 2000);
    },

    // ═══════════════════════════════════════════════════════════════════
    // CHART RENDERING
    // ═══════════════════════════════════════════════════════════════════

    /**
     * Render a chart using Plotly
     */
    renderChart(item) {
      const {
        chartType,
        title,
        data,
        config,
        xKey,
        yKey,
        xLabel,
        yLabel,
        yFormat,
        seriesKey,
      } = item;

      if (!data) return "";

      const chartId =
        "advisor-chart-" +
        Date.now() +
        "-" +
        Math.random().toString(36).substr(2, 9);

      let html = '<div class="advisor-chart-wrapper">';
      if (title) {
        html += `<div class="advisor-chart-title">${this.escapeHtml(
          title
        )}</div>`;
      }
      html += `<div id="${chartId}" class="advisor-chart"></div>`;
      html += "</div>";

      // Helper to convert key to readable label (e.g., "total_revenue" -> "Total Revenue")
      const keyToLabel = (key) => {
        if (!key) return "";
        return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      };

      // Auto-infer labels from keys if not provided
      const inferredXLabel =
        xLabel || (config && config.xLabel) || (xKey ? keyToLabel(xKey) : "");
      const inferredYLabel =
        yLabel || (config && config.yLabel) || (yKey ? keyToLabel(yKey) : "");

      // Auto-infer yFormat from common column names
      let inferredYFormat = yFormat || (config && config.yFormat);
      if (!inferredYFormat && yKey) {
        const lowerKey = yKey.toLowerCase();
        if (
          lowerKey.includes("revenue") ||
          lowerKey.includes("amount") ||
          lowerKey.includes("total") ||
          lowerKey.includes("spend") ||
          lowerKey.includes("cost") ||
          lowerKey.includes("price") ||
          lowerKey.includes("balance") ||
          lowerKey.includes("payment")
        ) {
          inferredYFormat = "$,.0f";
        } else if (
          lowerKey.includes("percent") ||
          lowerKey.includes("rate") ||
          lowerKey.includes("margin")
        ) {
          inferredYFormat = ",.1%";
        }
      }

      // Merge config with individual props and inferred values
      const chartConfig = {
        ...config,
        xLabel: inferredXLabel,
        yLabel: inferredYLabel,
        yFormat: inferredYFormat,
        seriesKey: seriesKey || (config && config.seriesKey),
      };

      // Schedule chart rendering after DOM update
      setTimeout(() => {
        this.renderPlotlyChart(
          chartId,
          chartType,
          data,
          chartConfig,
          xKey,
          yKey
        );
      }, 100);

      return html;
    },

    /**
     * Render Plotly chart
     * Supports:
     * - Single series: data = [{x: ..., y: ...}, ...] with xKey, yKey
     * - Multi-series: data = { labels: [...], series: { name1: [...], name2: [...] } }
     * - Chart.js format: data = { labels: [...], datasets: [{ data: [...], label: '...' }] }
     * - Or data with seriesKey to group by
     */
    renderPlotlyChart(elementId, chartType, data, config = {}, xKey, yKey) {
      const element = document.getElementById(elementId);
      if (!element || typeof Plotly === "undefined") {
        console.warn(
          "[AdvisorRenderer] Cannot render chart - element or Plotly not found"
        );
        return;
      }

      // Color palette for multi-series
      const colors = [
        "#3b82f6",
        "#10b981",
        "#f59e0b",
        "#ef4444",
        "#8b5cf6",
        "#06b6d4",
        "#ec4899",
        "#84cc16",
      ];

      // Determine data format and extract series
      let plotData = [];
      let labels = [];

      if (Array.isArray(data)) {
        if (!xKey || !yKey) {
          console.warn(
            "[AdvisorRenderer] Chart data is array but xKey/yKey not provided"
          );
          return;
        }

        // Check if yKey is an array (multi-series) or if there's a seriesKey
        if (Array.isArray(yKey)) {
          // Multi-series with multiple y columns
          labels = data.map((item) => item[xKey]);
          yKey.forEach((key, idx) => {
            plotData.push({
              name: key,
              x: labels,
              y: data.map((item) => item[key]),
              type: chartType === "line" ? "scatter" : chartType,
              mode: chartType === "line" ? "lines+markers" : undefined,
              line:
                chartType === "line"
                  ? { color: colors[idx % colors.length], width: 2 }
                  : undefined,
              marker: {
                color: colors[idx % colors.length],
                size: chartType === "line" ? 6 : undefined,
              },
            });
          });
        } else if (config.seriesKey) {
          // Group data by seriesKey for multi-series
          const seriesMap = {};
          data.forEach((item) => {
            const seriesName = item[config.seriesKey] || "Other";
            if (!seriesMap[seriesName]) {
              seriesMap[seriesName] = { x: [], y: [] };
            }
            seriesMap[seriesName].x.push(item[xKey]);
            seriesMap[seriesName].y.push(item[yKey]);
          });

          Object.keys(seriesMap).forEach((seriesName, idx) => {
            plotData.push({
              name: seriesName,
              x: seriesMap[seriesName].x,
              y: seriesMap[seriesName].y,
              type: chartType === "line" ? "scatter" : chartType,
              mode: chartType === "line" ? "lines+markers" : undefined,
              line:
                chartType === "line"
                  ? { color: colors[idx % colors.length], width: 2 }
                  : undefined,
              marker: {
                color: colors[idx % colors.length],
                size: chartType === "line" ? 6 : undefined,
              },
            });
          });
        } else {
          // Single series
          labels = data.map((item) => item[xKey]);
          const values = data.map((item) => item[yKey]);
          plotData = this.buildSingleSeriesPlotData(
            chartType,
            labels,
            values,
            colors[0]
          );
        }
      } else if (data && typeof data === "object") {
        if (data.datasets && Array.isArray(data.datasets)) {
          // Chart.js format: { labels: [...], datasets: [{ data: [...], label: '...' }] }
          labels = data.labels || [];
          data.datasets.forEach((dataset, idx) => {
            if (dataset.data && dataset.data.length > 0) {
              plotData.push({
                name: dataset.label || `Series ${idx + 1}`,
                x: labels,
                y: dataset.data,
                type: chartType === "line" ? "scatter" : chartType,
                mode: chartType === "line" ? "lines+markers" : undefined,
                line:
                  chartType === "line"
                    ? { color: colors[idx % colors.length], width: 2 }
                    : undefined,
                marker: {
                  color: colors[idx % colors.length],
                  size: chartType === "line" ? 6 : undefined,
                },
                hovertemplate: "%{x}<br>%{y:,.0f}<extra></extra>",
              });
            }
          });
        } else if (data.series) {
          // Multi-series format: { labels: [...], series: { name: values, ... } }
          labels = data.labels || [];
          Object.keys(data.series).forEach((seriesName, idx) => {
            plotData.push({
              name: seriesName,
              x: labels,
              y: data.series[seriesName],
              type: chartType === "line" ? "scatter" : chartType,
              mode: chartType === "line" ? "lines+markers" : undefined,
              line:
                chartType === "line"
                  ? { color: colors[idx % colors.length], width: 2 }
                  : undefined,
              marker: {
                color: colors[idx % colors.length],
                size: chartType === "line" ? 6 : undefined,
              },
            });
          });
        } else if (data.labels && data.values) {
          // Simple format: { labels: [...], values: [...] }
          labels = data.labels;
          plotData = this.buildSingleSeriesPlotData(
            chartType,
            data.labels,
            data.values,
            colors[0]
          );
        } else {
          console.warn("[AdvisorRenderer] Invalid chart data format");
          return;
        }
      } else {
        console.warn("[AdvisorRenderer] Invalid chart data format");
        return;
      }

      // Build layout with axis labels and hover configuration
      const layout = {
        margin: { t: 10, r: 20, b: 50, l: 70 },
        height: 260,
        font: { family: "Inter, system-ui, sans-serif", size: 11 },
        paper_bgcolor: "transparent",
        plot_bgcolor: "transparent",
        xaxis: {
          tickangle: -45,
          title: config.xLabel
            ? {
                text: config.xLabel,
                font: { size: 11, color: "#64748b" },
                standoff: 10,
              }
            : undefined,
          gridcolor: "rgba(0,0,0,0.05)",
          linecolor: "rgba(0,0,0,0.1)",
        },
        yaxis: {
          tickformat: config.yFormat || ",.0f",
          title: config.yLabel
            ? {
                text: config.yLabel,
                font: { size: 11, color: "#64748b" },
                standoff: 10,
              }
            : undefined,
          gridcolor: "rgba(0,0,0,0.05)",
          linecolor: "rgba(0,0,0,0.1)",
        },
        hovermode: "x unified",
        hoverlabel: {
          bgcolor: "#1e293b",
          bordercolor: "#334155",
          font: {
            family: "Inter, system-ui, sans-serif",
            size: 12,
            color: "#f8fafc",
          },
        },
        showlegend: plotData.length > 1,
        legend: {
          orientation: "h",
          yanchor: "bottom",
          y: 1.02,
          xanchor: "center",
          x: 0.5,
          font: { size: 10 },
        },
      };

      // Pie chart specific adjustments
      if (chartType === "pie") {
        layout.height = 240;
        layout.margin = { t: 10, r: 10, b: 10, l: 10 };
        layout.showlegend = true;
        layout.legend = {
          orientation: "h",
          y: -0.1,
          x: 0.5,
          xanchor: "center",
          font: { size: 10 },
        };
      }

      Plotly.newPlot(element, plotData, layout, {
        responsive: true,
        displayModeBar: false,
      });
    },

    /**
     * Build single series plot data
     */
    buildSingleSeriesPlotData(chartType, labels, values, color) {
      switch (chartType) {
        case "bar":
          return [
            {
              type: "bar",
              x: labels,
              y: values,
              marker: { color: color },
              hovertemplate: "%{x}<br>%{y:,.0f}<extra></extra>",
            },
          ];

        case "line":
          return [
            {
              type: "scatter",
              mode: "lines+markers",
              x: labels,
              y: values,
              line: { color: color, width: 2 },
              marker: { size: 6, color: color },
              hovertemplate: "%{x}<br>%{y:,.0f}<extra></extra>",
            },
          ];

        case "pie":
          return [
            {
              type: "pie",
              labels: labels,
              values: values,
              hole: 0.4,
              textinfo: "percent",
              hovertemplate:
                "%{label}<br>%{value:,.0f} (%{percent})<extra></extra>",
              marker: {
                colors: [
                  "#3b82f6",
                  "#10b981",
                  "#f59e0b",
                  "#ef4444",
                  "#8b5cf6",
                  "#06b6d4",
                  "#ec4899",
                  "#84cc16",
                ],
              },
            },
          ];

        default:
          console.warn("[AdvisorRenderer] Unknown chart type:", chartType);
          return [];
      }
    },

    // ═══════════════════════════════════════════════════════════════════
    // METRIC & ALERT RENDERING
    // ═══════════════════════════════════════════════════════════════════

    /**
     * Render a group of metrics (type: "metrics" with items array)
     */
    renderMetricsGroup(item) {
      if (
        !item.items ||
        !Array.isArray(item.items) ||
        item.items.length === 0
      ) {
        return "";
      }

      let html = '<div class="metric-row">';
      item.items.forEach((metric) => {
        html += this.renderMetric(metric);
      });
      html += "</div>";

      return html;
    },

    /**
     * Render a metric card
     */
    renderMetric(item) {
      const {
        label,
        value,
        format,
        formatting,
        delta,
        deltaLabel,
        suffix,
        context,
        sparkline,
      } = item;

      const fmt = format || formatting;
      let formattedValue = this.formatValue(value, fmt);
      if (suffix) formattedValue += suffix;

      let html = '<div class="metric-card">';
      html += `<div class="metric-value">${formattedValue}</div>`;
      html += `<div class="metric-label">${this.escapeHtml(label || "Metric")}`;

      if (delta !== undefined) {
        const deltaClass = delta >= 0 ? "trend-up" : "trend-down";
        const deltaIcon = delta >= 0 ? "fa-arrow-up" : "fa-arrow-down";
        html += `<span class="metric-delta ${deltaClass}">
                    <i class="fas ${deltaIcon}"></i>
                    ${Math.abs(delta).toFixed(1)}%
                </span>`;
      }

      html += "</div>"; // close metric-label

      if (sparkline && Array.isArray(sparkline) && sparkline.length > 0) {
        html += this.renderSparkline(sparkline);
      }

      if (context && context.length > 0) {
        html += '<div class="metric-context">';
        context.forEach((c) => {
          html += `<div class="context-item">${this.escapeHtml(c)}</div>`;
        });
        html += "</div>";
      }

      html += "</div>";

      return html;
    },

    /**
     * Render sparkline mini chart
     */
    renderSparkline(data) {
      const width = 80;
      const height = 24;
      const max = Math.max(...data);
      const min = Math.min(...data);
      const range = max - min || 1;

      const points = data
        .map((val, idx) => {
          const x = (idx / (data.length - 1)) * width;
          const y = height - ((val - min) / range) * height;
          return `${x},${y}`;
        })
        .join(" ");

      return `
                <div class="metric-sparkline">
                    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
                        <polyline fill="none" stroke="#3b82f6" stroke-width="1.5" points="${points}"/>
                    </svg>
                </div>
            `;
    },

    /**
     * Render an alert box
     */
    renderAlert(item, type) {
      const icons = {
        warning: "fa-exclamation-triangle",
        success: "fa-check-circle",
        info: "fa-info-circle",
      };

      const text = item.text || item.message || "";

      return `
                <div class="advisor-alert advisor-alert-${type}">
                    <i class="fas ${icons[type] || icons.info}"></i>
                    <span>${this.renderMarkdown(text)}</span>
                </div>
            `;
    },

    /**
     * Render a code block
     */
    renderCode(item) {
      const { code, language, title } = item;

      let html = '<div class="advisor-code-wrapper">';

      if (title) {
        html += `<div class="code-title">${this.escapeHtml(title)}</div>`;
      }

      html += `<pre class="advisor-code${
        language ? ` language-${language}` : ""
      }">`;
      html += `<code>${this.escapeHtml(code)}</code>`;
      html += "</pre></div>";

      return html;
    },

    // ═══════════════════════════════════════════════════════════════════
    // DEEP LINK UTILITIES - NetSuite Record Links
    // ═══════════════════════════════════════════════════════════════════

    /**
     * Column names that represent internal IDs for transactions
     */
    TRANSACTION_ID_COLUMNS: [
      "id",
      "internalid",
      "internal_id",
      "transaction_id",
      "tranid_internal",
    ],

    /**
     * Column names that should be linked (display columns)
     */
    LINKABLE_DISPLAY_COLUMNS: [
      "document_number",
      "tranid",
      "doc_number",
      "invoice_number",
      "bill_number",
      "transaction_number",
    ],

    /**
     * Entity ID columns and their types
     */
    ENTITY_ID_COLUMNS: {
      vendor_id: "vendor",
      customer_id: "customer",
      entity_id: "entity",
      employee_id: "employee",
    },

    /**
     * Entity name columns that can be linked
     */
    ENTITY_NAME_COLUMNS: [
      "vendor_name",
      "customer_name",
      "entity_name",
      "employee_name",
      "vendor",
      "customer",
      "entity",
    ],

    /**
     * Get NetSuite URL for a transaction
     * Uses generic transaction URL that works for all transaction types
     */
    getTransactionUrl(internalId) {
      if (!internalId) return null;
      // Generic transaction URL - works for any transaction type
      return `/app/accounting/transactions/transaction.nl?id=${internalId}`;
    },

    /**
     * Get NetSuite URL for an entity
     */
    getEntityUrl(internalId, entityType) {
      if (!internalId) return null;

      switch (entityType) {
        case "vendor":
          return `/app/common/entity/vendor.nl?id=${internalId}`;
        case "customer":
          return `/app/common/entity/custjob.nl?id=${internalId}`;
        case "employee":
          return `/app/common/entity/employee.nl?id=${internalId}`;
        default:
          // Generic entity - try vendor first (most common in AP queries)
          return `/app/common/entity/entity.nl?id=${internalId}`;
      }
    },

    /**
     * Find the internal ID column in a row
     * Returns { column: 'id', value: 12345 } or null
     */
    findTransactionId(row, columns) {
      for (const col of this.TRANSACTION_ID_COLUMNS) {
        // Check normalized column names
        for (const actualCol of columns) {
          if (this.normalizeKey(actualCol) === col) {
            const value = this.getRowValue(row, actualCol);
            if (value && !isNaN(parseInt(value))) {
              return { column: actualCol, value: parseInt(value) };
            }
          }
        }
        // Also check direct row keys
        if (row[col] && !isNaN(parseInt(row[col]))) {
          return { column: col, value: parseInt(row[col]) };
        }
      }
      return null;
    },

    /**
     * Find entity ID and type from row
     * Returns { id: 12345, type: 'vendor' } or null
     */
    findEntityId(row, columns) {
      for (const [colPattern, entityType] of Object.entries(
        this.ENTITY_ID_COLUMNS
      )) {
        for (const actualCol of columns) {
          if (this.normalizeKey(actualCol) === colPattern) {
            const value = this.getRowValue(row, actualCol);
            if (value && !isNaN(parseInt(value))) {
              return {
                id: parseInt(value),
                type: entityType,
                column: actualCol,
              };
            }
          }
        }
        // Check direct row keys
        if (row[colPattern] && !isNaN(parseInt(row[colPattern]))) {
          return {
            id: parseInt(row[colPattern]),
            type: entityType,
            column: colPattern,
          };
        }
      }
      return null;
    },

    /**
     * Check if a column should display a transaction link
     */
    isLinkableDisplayColumn(colKey) {
      return this.LINKABLE_DISPLAY_COLUMNS.includes(colKey);
    },

    /**
     * Check if a column should display an entity link
     */
    isEntityNameColumn(colKey) {
      return this.ENTITY_NAME_COLUMNS.includes(colKey);
    },

    /**
     * Create an HTML link for a transaction
     */
    createTransactionLink(displayValue, internalId) {
      if (!internalId) return this.escapeHtml(String(displayValue));
      const url = this.getTransactionUrl(internalId);
      const escaped = this.escapeHtml(String(displayValue));
      return `<a href="${url}" target="_blank" class="ns-link" title="Open in NetSuite">${escaped}<i class="fas fa-external-link-alt ns-link-icon"></i></a>`;
    },

    /**
     * Create an HTML link for an entity
     */
    createEntityLink(displayValue, internalId, entityType) {
      if (!internalId) return this.escapeHtml(String(displayValue));
      const url = this.getEntityUrl(internalId, entityType);
      const escaped = this.escapeHtml(String(displayValue));
      return `<a href="${url}" target="_blank" class="ns-link" title="Open ${
        entityType || "entity"
      } in NetSuite">${escaped}<i class="fas fa-external-link-alt ns-link-icon"></i></a>`;
    },

    /**
     * Format cell value with potential deep link
     * Only for standard and grouped tables, NOT financial statements
     */
    formatCellWithLink(value, format, colKey, row, columns) {
      // Format the value first
      let formatted = this.formatValue(value, format);

      // Check if this is a linkable transaction column (document_number, tranid, etc.)
      if (this.isLinkableDisplayColumn(colKey)) {
        const txnId = this.findTransactionId(row, columns);
        if (txnId) {
          return this.createTransactionLink(value, txnId.value);
        }
      }

      // Check if this is the ID column itself - make it clickable
      if (
        this.TRANSACTION_ID_COLUMNS.includes(colKey) &&
        value &&
        !isNaN(parseInt(value))
      ) {
        return this.createTransactionLink(value, parseInt(value));
      }

      // Check if this is an entity name column
      if (this.isEntityNameColumn(colKey)) {
        const entityInfo = this.findEntityId(row, columns);
        if (entityInfo) {
          // Determine entity type from column name if not from ID column
          let entityType = entityInfo.type;
          if (colKey.includes("vendor")) entityType = "vendor";
          else if (colKey.includes("customer")) entityType = "customer";
          else if (colKey.includes("employee")) entityType = "employee";

          return this.createEntityLink(value, entityInfo.id, entityType);
        }
      }

      return formatted;
    },

    // ═══════════════════════════════════════════════════════════════════
    // FORMATTING UTILITIES
    // ═══════════════════════════════════════════════════════════════════

    /**
     * Format a value based on type
     */
    formatValue(value, format) {
      if (value === null || value === undefined) return "—";

      switch (format) {
        case "currency":
          return this.formatCurrency(value);
        case "percent":
          return this.formatPercent(value);
        case "number":
          return this.formatNumber(value);
        case "date":
          return this.formatDate(value);
        default:
          return this.escapeHtml(String(value));
      }
    },

    /**
     * Format as currency
     */
    formatCurrency(value) {
      if (typeof value !== "number") value = parseFloat(value) || 0;

      const absValue = Math.abs(value);
      let formatted;

      if (absValue >= 1000000) {
        formatted = "$" + (absValue / 1000000).toFixed(1) + "M";
      } else if (absValue >= 1000) {
        formatted =
          "$" +
          absValue.toLocaleString("en-US", {
            minimumFractionDigits: 0,
            maximumFractionDigits: 0,
          });
      } else {
        formatted =
          "$" +
          absValue.toLocaleString("en-US", {
            minimumFractionDigits: 0,
            maximumFractionDigits: 2,
          });
      }

      if (value < 0) {
        return `<span class="negative">(${formatted})</span>`;
      }
      return formatted;
    },

    /**
     * Format currency absolute value (no negative handling)
     */
    formatCurrencyAbs(value) {
      if (typeof value !== "number") value = parseFloat(value) || 0;
      value = Math.abs(value);

      if (value >= 1000000) {
        return "$" + (value / 1000000).toFixed(1) + "M";
      } else if (value >= 1000) {
        return (
          "$" +
          value.toLocaleString("en-US", {
            minimumFractionDigits: 0,
            maximumFractionDigits: 0,
          })
        );
      } else {
        return (
          "$" +
          value.toLocaleString("en-US", {
            minimumFractionDigits: 0,
            maximumFractionDigits: 2,
          })
        );
      }
    },

    /**
     * Format as percent
     */
    formatPercent(value) {
      if (typeof value !== "number") value = parseFloat(value) || 0;
      return value.toFixed(1) + "%";
    },

    /**
     * Format as number
     */
    formatNumber(value) {
      if (typeof value !== "number") value = parseFloat(value) || 0;
      return value.toLocaleString("en-US", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      });
    },

    /**
     * Format as date
     */
    formatDate(value) {
      if (!value) return "—";

      try {
        const date = new Date(value);
        return date.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        });
      } catch (e) {
        return String(value);
      }
    },

    /**
     * Escape HTML entities
     */
    escapeHtml(text) {
      if (typeof text !== "string") return String(text);

      const div = document.createElement("div");
      div.textContent = text;
      return div.innerHTML;
    },
  };

  // Export to global scope
  window.AdvisorRenderer = AdvisorRenderer;

  if (window.Gantry) {
    window.Gantry.AdvisorRenderer = AdvisorRenderer;
  }
})(window);
