import assert from "node:assert/strict";
import test from "node:test";
import { selfTest } from "../src/index.js";

test("autoteste interno valida parser, agrupamento, card e limpeza da matéria", async () => {
  const result = await selfTest();
  assert.equal(result.ok, true);
  assert.equal(result.parserItems, 2);
  assert.equal(result.groupedTopics, 1);
  assert.equal(result.cardItems, 2);
  assert.ok(result.articleWords >= 45);
  assert.equal(result.articleNoiseRemoved, true);
});
