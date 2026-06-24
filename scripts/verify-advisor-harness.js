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
  orchestrator: read('src/FileCabinet/SuiteApps/com.gantry.finance/lib/advisor/Lib_Advisor_Orchestrator.js'),
  cache: read('src/FileCabinet/SuiteApps/com.gantry.finance/lib/advisor/Lib_Advisor_Cache.js'),
  tools: read('src/FileCabinet/SuiteApps/com.gantry.finance/lib/advisor/Lib_Advisor_Tools.js'),
  agent: read('src/FileCabinet/SuiteApps/com.gantry.finance/lib/advisor/Lib_Advisor_StreamingAgent.js')
};

expectContains(files.cache, 'const CACHE_SCOPE = cache.Scope.PRIVATE;', 'advisor cache');
expectContains(files.cache, 'owner: getCurrentOwnerContext()', 'advisor cache');
expectContains(files.cache, 'function progressHasAccess(requestId)', 'advisor cache');
expectContains(files.cache, "status: 'access_denied'", 'advisor cache');
expectContains(files.cache, 'requestContext: requestContext || null', 'advisor cache');
expectContains(files.cache, 'owner: getCurrentOwnerContext()', 'advisor cache data owner');
expectContains(files.cache, 'if (owner && !isOwnerMatch(owner)) {', 'advisor cache data ownership');
expectContains(files.cache, 'return PREFIX.TOOL + `${owner.userId}_${owner.roleId}_${toolName}_${argsHash}`;', 'advisor cache tool key');
expectContains(files.cache, 'Stored subset only:', 'advisor cache truncated prompt note');

expectContains(files.orchestrator, 'const requestContext = params.context || {};', 'advisor orchestrator');
expectContains(files.orchestrator, 'StreamingAgent.initState(message, sessionContext, requestId, history, requestContext)', 'advisor orchestrator');
expectContains(files.orchestrator, 'Cache.create(requestId, message, agentState, requestContext);', 'advisor orchestrator');
expectContains(files.orchestrator, 'if (!Cache.hasAccess(requestId)) {', 'advisor orchestrator');

expectContains(files.router, 'function requireAdvisorAccess(context, data)', 'advisor router');
expectContains(files.router, "if (action === 'advisor_chat_async') {", 'advisor router');
expectContains(files.router, 'const advisorAccessError = requireAdvisorAccess(context, data);', 'advisor router');

expectContains(files.tools, "'../Lib_Permissions'", 'advisor tools');
expectContains(files.tools, 'function checkToolAccess(toolName, args)', 'advisor tools');
expectContains(files.tools, 'function isToolVisibleToCurrentUser(toolName)', 'advisor tools');
expectContains(files.tools, 'Detailed query-cache follow-ups are restricted to administrators.', 'advisor tools');
expectContains(files.tools, 'request_id is required for query result refs', 'advisor tools');
expectContains(files.tools, 'Permissions.filterDashboards(dashboards);', 'advisor tools');
expectContains(files.tools, 'const access = checkToolAccess(toolName, normalizedArgs);', 'advisor tools');

expectContains(files.agent, 'requestContext: requestContext || null', 'advisor streaming agent');
expectContains(files.agent, 'ACTIVE REQUEST CONTEXT:', 'advisor streaming agent');
expectContains(files.agent, 'Deterministic mode skips speculative parameter rewrites', 'advisor streaming agent');
expectContains(files.agent, 'Deterministic fallback based on related data domain', 'advisor streaming agent');
expectContains(files.agent, 'deterministicFallback: true', 'advisor streaming agent');
expectContains(files.agent, 'if (enhanced.ref_id && !enhanced.request_id) {', 'advisor streaming agent');
expectContains(files.agent, 'enhanced.request_id = matchedRef.requestId;', 'advisor streaming agent');

expectNotContains(files.agent, "purpose: 'SCA:general_tool_check'", 'advisor streaming agent');

console.log('Advisor harness verification passed.');
