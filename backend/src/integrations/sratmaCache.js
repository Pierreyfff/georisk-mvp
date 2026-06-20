const { listarAccidenteMapa } = require("./sratma.client");

let activeIds = new Set();
let lastFetch = null;

function update(ids) {
  activeIds = new Set(ids);
  lastFetch = new Date();
}

function getActiveIds() {
  return activeIds;
}

function getLastFetch() {
  return lastFetch;
}

function isActive(externalId) {
  return activeIds.has(externalId);
}

function getCount() {
  return activeIds.size;
}

module.exports = { update, getActiveIds, getLastFetch, isActive, getCount };
