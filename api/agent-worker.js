'use strict';

const { handleCallback } = require('@vercel/queue');
const { processAgentJob } = require('../lib/agent-runtime');
const { runQueueCallback } = require('../lib/queue-http');

const callback = handleCallback(async (message) => {
  if (!message || typeof message.jobId !== 'string') throw new Error('Invalid Mine agent queue message.');
  await processAgentJob(message.jobId);
});

module.exports = async function agentWorker(req, res) {
  try { await runQueueCallback(req, res, callback); }
  catch (error) {
    console.error('[mine] agent queue consumer failed:', error && error.message);
    if (!res.headersSent) { res.statusCode = 500; res.end('Agent queue processing failed'); }
    else if (!res.writableEnded) res.end();
  }
};
module.exports.config = { api: { bodyParser: false } };
