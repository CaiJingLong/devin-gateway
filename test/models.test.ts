import { expect, test, describe } from "bun:test";

import { listModels } from "../src/models.ts";

describe("listModels catalog", () => {
  test("returns a large non-empty catalog", () => {
    const models = listModels();
    expect(models.length).toBeGreaterThan(100);
  });

  test("every entry has well-formed ModelInfo fields", () => {
    const models = listModels();
    for (const m of models) {
      expect(typeof m.id).toBe("string");
      expect(m.id.length).toBeGreaterThan(0);
      expect(typeof m.name).toBe("string");
      expect(m.name.length).toBeGreaterThan(0);
      expect(m.contextWindow).toBeGreaterThan(0);
      expect(Number.isFinite(m.contextWindow)).toBe(true);
      expect(m.maxTokens).toBeGreaterThan(0);
      expect(Number.isFinite(m.maxTokens)).toBe(true);
      expect(typeof m.reasoning).toBe("boolean");
    }
  });

  test("ids are unique", () => {
    const models = listModels();
    const ids = models.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("repeated calls return equivalent content", () => {
    const a = listModels();
    const b = listModels();
    expect(b.length).toBe(a.length);
    expect(new Set(b.map((m) => m.id))).toEqual(new Set(a.map((m) => m.id)));
  });

  test("known sample models are present", () => {
    const ids = new Set(listModels().map((m) => m.id));
    expect(ids.has("glm-5-2")).toBe(true);
    expect(ids.has("claude-opus-4-8-low")).toBe(true);
    expect(ids.has("gpt-5-5-none")).toBe(true);
  });
});
