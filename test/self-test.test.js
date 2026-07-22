import assert from "node:assert/strict";
import test from "node:test";
import { selfTest } from "../src/index.js";

test("autoteste interno valida parser, agrupamento e card", async () => {
  const result = await selfTest();
  assert.deepEqual(result, { ok: true, parserItems: 2, groupedTopics: 1, cardItems: 2 });
});
