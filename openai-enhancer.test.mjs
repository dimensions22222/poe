import assert from "node:assert/strict";
import test from "node:test";
import { enhanceAnalysis } from "./openai-enhancer.mjs";

const sampleAnalysis = {
  host: "example.com",
  title: "Example page",
  description: "A sample website",
  pageCount: 1,
  counts: { headings: 2, links: 4, images: 1 },
  headings: [{ level: 1, text: "Welcome" }],
  technologies: [{ name: "Example CMS", confidence: 0.8 }],
  patterns: ["responsive-layout"],
  components: ["hero-section"],
  palette: ["#123456"],
  typography: ["Arial"],
  design: { responsiveMediaQueries: 1, spacingTokens: ["1rem"] },
  findings: [{ severity: "medium", title: "Missing alt text", detail: "One image has no alt attribute.", recommendation: "Add descriptive alt text." }],
  sourceHtml: "<html>must not be sent</html>"
};

test("AI enhancement sends only extracted report data and returns response text", async () => {
  let requestUrl;
  let requestOptions;
  const result = await enhanceAnalysis(sampleAnalysis, {
    apiKey: "test-key",
    model: "test-model",
    fetchImpl: async (url, options) => {
      requestUrl = url;
      requestOptions = options;
      return {
        ok: true,
        async json() {
          return {
            output: [{
              type: "message",
              content: [{ type: "output_text", text: "Overview\nThe page has a clear heading." }]
            }]
          };
        }
      };
    }
  });

  assert.equal(requestUrl, "https://api.openai.com/v1/responses");
  assert.equal(requestOptions.headers.Authorization, "Bearer test-key");
  const body = JSON.parse(requestOptions.body);
  assert.equal(body.model, "test-model");
  assert.equal(body.store, false);
  assert.equal(body.input.includes("must not be sent"), false);
  assert.equal(body.input.includes("example.com"), true);
  assert.match(body.instructions, /untrusted page-derived text/);
  assert.equal(result, "Overview\nThe page has a clear heading.");
});

test("AI enhancement reports provider HTTP failures without exposing response bodies", async () => {
  await assert.rejects(
    enhanceAnalysis(sampleAnalysis, {
      apiKey: "test-key",
      fetchImpl: async () => ({
        ok: false,
        status: 429,
        async text() {
          return "provider detail";
        }
      })
    }),
    error => error.message === "The AI enhancement service returned HTTP 429."
  );
});

test("AI enhancement rejects empty model output", async () => {
  await assert.rejects(
    enhanceAnalysis(sampleAnalysis, {
      apiKey: "test-key",
      fetchImpl: async () => ({
        ok: true,
        async json() {
          return { output: [] };
        }
      })
    }),
    /returned no analysis text/
  );
});
