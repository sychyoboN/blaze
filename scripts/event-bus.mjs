// event-bus.mjs — a tiny synchronous in-process pub/sub for the activity feed.
export function createBus() {
  const subs = new Set();
  return {
    publish(evt) {
      for (const fn of subs) {
        try { fn(evt); } catch { /* one bad subscriber must not break the rest */ }
      }
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    size() { return subs.size; },
  };
}
