import assert from "node:assert/strict";
import test from "node:test";
import { createModel } from "../src/web/model.js";

test("URL normalization adds HTTPS and retains valid HTTP(S) URLs", () => {
  const model = createModel();
  assert.equal(model.normalizeUrl("example.com"), "https://example.com");
  assert.equal(
    model.normalizeUrl("http://example.com/path"),
    "http://example.com/path",
  );
});

test("URL normalization rejects unsupported protocols and embedded credentials", () => {
  const model = createModel();
  assert.throws(
    () => model.normalizeUrl("ftp://example.com"),
    /Only HTTP and HTTPS/,
  );
  assert.throws(
    () => model.normalizeUrl("https://user:pass@example.com"),
    /usernames or passwords/,
  );
});
