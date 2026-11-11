import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzeDocument,
  isPublicAddress,
  normalizeWebsiteUrl,
  parseRobotsRules,
  robotsAllows
} from "../src/engine/analysis-engine.mjs";

test("URL validation accepts public HTTP(S) pages and rejects non-web protocols", () => {
  assert.equal(normalizeWebsiteUrl("https://example.com/a#section").href, "https://example.com/a");
  assert.throws(() => normalizeWebsiteUrl("file:///etc/passwd"), /Only HTTP and HTTPS/);
  assert.throws(() => normalizeWebsiteUrl("https://user:pass@example.com"), /usernames or passwords/);
  assert.throws(() => normalizeWebsiteUrl("http://example.com:8080"), /standard public website ports/);
  assert.throws(() => normalizeWebsiteUrl("http://127.0.0.1/"), /Private, reserved/);
});

test("robots rules honor user-agent groups, allow overrides, and crawl delay", () => {
  const rules = parseRobotsRules(`User-agent: *\nDisallow: /private\nCrawl-delay: 2\nAllow: /private/public$`);
  assert.equal(robotsAllows(new URL("https://example.com/private"), rules), false);
  assert.equal(robotsAllows(new URL("https://example.com/private/public"), rules), true);
  assert.equal(rules.crawlDelayMs, 2000);
});

test("SSRF address screening rejects private, reserved, mapped, and metadata ranges", () => {
  for (const address of [
    "127.0.0.1",
    "10.0.0.1",
    "172.20.1.1",
    "192.168.1.2",
    "169.254.169.254",
    "168.63.129.16",
    "100.64.0.1",
    "2001:db8::1",
    "2001:2::1",
    "2001:20::1",
    "2001:10::1",
    "3fff::1",
    "::1",
    "::ffff:127.0.0.1"
  ]) {
    assert.equal(isPublicAddress(address), false, `${address} should not be public`);
  }
  assert.equal(isPublicAddress("8.8.8.8"), true);
  assert.equal(isPublicAddress("2606:4700:4700::1111"), true);
});

test("document analysis identifies structure, technologies, and basic quality findings", () => {
  const html = `<!doctype html><html><head><title>Example</title><script src="/_next/static/app.js"></script>
    <style>body{font-family:Inter,sans-serif;color:#123456}@media(max-width:600px){body{padding:1rem}}</style></head>
    <body><nav><a href="/">Home</a></nav><main><h1>Welcome</h1><img src="/hero.jpg"><input></main></body></html>`;
  const result = analyzeDocument(html, "https://example.com/");
  assert.equal(result.title, "Example");
  assert.equal(result.counts.navigationLandmarks, 1);
  assert.equal(result.counts.images, 1);
  assert.equal(result.counts.externalScripts, 1);
  assert.equal(result.technologies.some(item => item.name === "Next.js"), true);
  assert.equal(result.patterns.includes("responsive-layout"), true);
  assert.equal(result.findings.some(item => item.id === "missing-alt"), true);
  assert.equal(result.findings.some(item => item.id === "unlabeled-controls"), true);
});
