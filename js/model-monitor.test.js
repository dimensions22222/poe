import assert from "node:assert/strict";
import test from "node:test";
import { createModel } from "./model.js";

test("monitor requests create, list, and delete scheduled websites", async () => {
  const calls = [];
  const model = createModel(async (path, options = {}) => {
    calls.push({ path, options });
    return {
      ok: true,
      async json() {
        return path === "/api/monitors" && options.method !== "POST"
          ? { monitors: [] }
          : { id: "monitor-id" };
      }
    };
  });

  await model.addMonitor("https://example.com", 3, 24);
  assert.deepEqual(await model.loadMonitors(), { monitors: [] });
  await model.removeMonitor("monitor-id");
  assert.equal(calls[0].options.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    url: "https://example.com",
    maxPages: 3,
    intervalHours: 24
  });
  assert.equal(calls[1].path, "/api/monitors");
  assert.equal(calls[2].path, "/api/monitors/monitor-id");
  assert.equal(calls[2].options.method, "DELETE");
});
