const subscribers = new Set();

/**
 * subscribe(fn) -> devuelve función unsubscribe
 * fn recibe: (event) => void
 */
function subscribe(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

function publish(event) {
  for (const fn of subscribers) fn(event);
}

module.exports = { subscribe, publish };