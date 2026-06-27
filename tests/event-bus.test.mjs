import { test } from "node:test";
import assert from "node:assert/strict";
import { createBus } from "../scripts/event-bus.mjs";

test("subscribers receive published events; unsubscribe stops them", () => {
  const bus = createBus();
  const seen = [];
  const off = bus.subscribe((e) => seen.push(e));
  bus.publish({ a: 1 });
  assert.deepEqual(seen, [{ a: 1 }]);
  off();
  bus.publish({ a: 2 });
  assert.deepEqual(seen, [{ a: 1 }]);
  assert.equal(bus.size(), 0);
});

test("a throwing subscriber does not break others", () => {
  const bus = createBus();
  const seen = [];
  bus.subscribe(() => { throw new Error("boom"); });
  bus.subscribe((e) => seen.push(e));
  bus.publish({ ok: true });
  assert.deepEqual(seen, [{ ok: true }]);
});
