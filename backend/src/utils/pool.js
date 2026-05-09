async function asyncPool(concurrency, items, iteratorFn) {
  const ret = [];
  const executing = new Set();

  for (const item of items) {
    const p = Promise.resolve().then(() => iteratorFn(item));
    ret.push(p);
    executing.add(p);

    const clean = () => executing.delete(p);
    p.then(clean).catch(clean);

    if (executing.size >= concurrency) {
      await Promise.race(executing);
    }
  }

  return Promise.allSettled(ret);
}

module.exports = { asyncPool };