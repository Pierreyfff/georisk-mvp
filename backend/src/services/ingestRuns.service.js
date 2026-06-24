const repo = require("../repositories/ingestRuns.repository");

async function startRun(params) {
  return repo.createRun(params);
}

async function endRun(params) {
  return repo.finishRun(params);
}

async function getRunById(id) {
  return repo.findById(id);
}

async function listRuns({ fuente, mode, limit } = {}) {
  return repo.listRuns({ fuente, mode, limit });
}

module.exports = {
  startRun,
  endRun,
  getRunById,
  listRuns,
};