const repo = require("../repositories/ingestRuns.repository");

async function startRun(params) {
  return repo.createRun(params);
}

async function endRun(params) {
  return repo.finishRun(params);
}

module.exports = {
  startRun,
  endRun,
};