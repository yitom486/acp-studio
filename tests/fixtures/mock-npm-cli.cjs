// Offline npm view stand-in: exercises real subprocess/event-loop behavior.
const fs = require('node:fs');
if (process.env.ACP_TEST_NPM_CALLS) fs.appendFileSync(process.env.ACP_TEST_NPM_CALLS, 'query\n');
setTimeout(() => {
  if (process.argv[3] === 'test-failure') {
    console.error('mock registry unavailable');
    process.exit(1);
  }
  console.log('9.9.9-test');
}, Number(process.env.ACP_TEST_NPM_DELAY || 250));
