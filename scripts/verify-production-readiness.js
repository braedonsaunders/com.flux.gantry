#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8');
}

function expectContains(source, needle, label) {
  if (!source.includes(needle)) {
    throw new Error(label + ' missing: ' + needle);
  }
}

function expectNotContains(source, needle, label) {
  if (source.includes(needle)) {
    throw new Error(label + ' still contains forbidden pattern: ' + needle);
  }
}

const files = {
  router: read('src/FileCabinet/SuiteApps/com.gantry.finance/suitelet/Gantry_Router.js'),
  config: read('src/FileCabinet/SuiteApps/com.gantry.finance/lib/Lib_Config.js'),
  permissions: read('src/FileCabinet/SuiteApps/com.gantry.finance/lib/Lib_Permissions.js'),
  core: read('src/FileCabinet/SuiteApps/com.gantry.finance/lib/Lib_Core.js'),
  burdenLib: read('src/FileCabinet/SuiteApps/com.gantry.finance/lib/Lib_Burden_Data.js'),
  cashflowLib: read('src/FileCabinet/SuiteApps/com.gantry.finance/lib/Lib_Cashflow_Data.js'),
  healthLib: read('src/FileCabinet/SuiteApps/com.gantry.finance/lib/Lib_Health_Data.js'),
  integrityLib: read('src/FileCabinet/SuiteApps/com.gantry.finance/lib/Lib_Integrity_Data.js'),
  spendLib: read('src/FileCabinet/SuiteApps/com.gantry.finance/lib/Lib_SpendVelocity_Data.js'),
  customerLib: read('src/FileCabinet/SuiteApps/com.gantry.finance/lib/Lib_CustomerValue_Data.js'),
  vendorLib: read('src/FileCabinet/SuiteApps/com.gantry.finance/lib/Lib_VendorPerformance_Data.js'),
  settingsClient: read('src/FileCabinet/SuiteApps/com.gantry.finance/client/dashboards/Dashboard.Settings.js'),
  burdenClient: read('src/FileCabinet/SuiteApps/com.gantry.finance/client/dashboards/Dashboard.Burden.js'),
  customerClient: read('src/FileCabinet/SuiteApps/com.gantry.finance/client/dashboards/Dashboard.CustomerValue.js'),
  clientCore: read('src/FileCabinet/SuiteApps/com.gantry.finance/client/core/Gantry.Core.js')
};

expectContains(files.router, 'function requireAdminForConfig', 'router');
expectContains(files.router, 'function requireDashboardAccess', 'router');
expectContains(files.config, 'function preserveStoredSecrets', 'config');
expectContains(files.config, 'function redactSecretsForApi', 'config');
expectContains(files.permissions, "dashboard.id !== 'settings' || isAdmin()", 'permissions');
expectContains(files.core, 'function evaluateFormula(expression)', 'core');
expectContains(files.settingsClient, 'Configured - leave blank to keep existing value', 'settings client');
expectContains(files.clientCore, 'const GantryFormula = {', 'client core');

[
  [files.burdenLib, 'Math.round(totalAccounts * 0.1)', 'burden lib'],
  [files.burdenLib, 'Using default average salary ($75,000).', 'burden lib'],
  [files.spendLib, "results.currencyInfo = { symbol: 'CAD', name: 'CAN' };", 'spend velocity lib'],
  [files.integrityLib, 'Math.max(...allRecords.map(r => r.userCount), 0)', 'integrity lib'],
  [files.customerClient, 'Estimated Margin (applies fixed %)', 'customer client'],
  [files.customerClient, 'estimated_fallback', 'customer client'],
  [files.customerClient, 'gl_rollup_fallback', 'customer client']
].forEach(([source, needle, label]) => expectNotContains(source, needle, label));

[
  ['lib burden', files.burdenLib],
  ['lib cashflow', files.cashflowLib],
  ['client burden', files.burdenClient],
  ['client core', files.clientCore]
].forEach(([label, source]) => {
  expectNotContains(source, 'new Function(', label);
  expectNotContains(source, 'eval(', label);
});

[
  ['burden client', files.burdenClient],
  ['customer client', files.customerClient]
].forEach(([label, source]) => {
  expectNotContains(source, 'Math.random(', label);
});

[
  ['health lib', files.healthLib],
  ['cashflow lib', files.cashflowLib],
  ['time lib', read('src/FileCabinet/SuiteApps/com.gantry.finance/lib/Lib_Time_Data.js')],
  ['burden lib', files.burdenLib],
  ['vendor lib', files.vendorLib],
  ['customer lib', files.customerLib],
  ['integrity lib', files.integrityLib]
].forEach(([label, source]) => {
  expectNotContains(source, "label: 'Unknown'", label);
});

console.log('Production-readiness verification passed.');
