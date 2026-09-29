#!/usr/bin/env node
const base = (process.argv[2] || process.env.LITMATRIX_BASE_URL || 'http://localhost:3001').replace(/\/$/, '');
async function check(path, expected) {
  const response = await fetch(`${base}${path}`);
  const text = await response.text();
  const ok = response.status === expected;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${response.status} ${path}`);
  if (!ok) console.log(text.slice(0, 500));
  return ok;
}
const results = [];
results.push(await check('/healthz', 200));
results.push(await check('/.well-known/oauth-protected-resource', 200));
results.push(await check('/.well-known/oauth-authorization-server', 200));
results.push(await check('/mcp', 401));
if (results.every(Boolean)) { console.log(`\nLitlMatrix MCP smoke test passed: ${base}`); process.exit(0); }
console.error(`\nLitlMatrix MCP smoke test failed: ${base}`); process.exit(1);
