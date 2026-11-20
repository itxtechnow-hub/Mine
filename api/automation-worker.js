'use strict';

const { handleCallback } = require('@vercel/queue');
const { processAutomationSchedule } = require('../lib/automation-worker');
const { runQueueCallback } = require('../lib/queue-http');

const callback = handleCallback(async (message) => processAutomationSchedule(message));

module.exports = async function automationWorker(req, res) {
  try { await runQueueCallback(req, res, callback); }
  catch (error) {
    console.error('[mine] automation queue consumer failed:', error && error.message);
    if (!res.headersSent) { res.statusCode = 500; res.end('Automation queue processing failed'); }
    else if (!res.writableEnded) res.end();
  }
};
module.exports.config = { api: { bodyParser: false } };
