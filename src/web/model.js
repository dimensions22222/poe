export const demoSource = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Northstar Studio</title>
  <style>
    :root { --ink: #172033; --accent: #5b65ea; }
    body { margin: 0; font-family: Arial, sans-serif; color: var(--ink); background: #f6f7fb; }
    header { padding: 22px 7%; display: flex; justify-content: space-between; background: white; }
    .logo { font-weight: 800; letter-spacing: -.04em; }
    nav a { margin-left: 18px; color: #596274; text-decoration: none; }
    main { max-width: 900px; margin: 80px auto; padding: 0 24px; }
    h1 { max-width: 670px; font-size: clamp(42px, 8vw, 78px); line-height: .98; letter-spacing: -.06em; }
    p { max-width: 520px; color: #697386; line-height: 1.7; }
    .cta { display: inline-block; margin-top: 18px; padding: 13px 18px; border-radius: 8px; color: white; background: var(--accent); text-decoration: none; }
  </style>
</head>
<body>
  <header>
    <div class="logo">northstar<span style="color:#5b65ea">.</span></div>
    <nav><a href="#work">Work</a><a href="#about">About</a><a href="#contact">Contact</a></nav>
  </header>
  <main>
    <div>INDEPENDENT DIGITAL STUDIO</div>
    <h1>Make your next big idea impossible to ignore.</h1>
    <p>We partner with thoughtful teams to create useful digital products and identities that move businesses forward.</p>
    <a class="cta" href="#contact">Start a project &rarr;</a>
  </main>
</body>
</html>`;

export function createModel(fetchImpl = fetch) {
  async function request(path, options = {}, retries = 2) {
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const response = await fetchImpl(path, {
          ...options,
          cache: "no-store",
          headers: { Accept: "application/json", ...(options.headers || {}) }
        });
        const payload = await response.json();
        if (!response.ok) {
          const error = new Error(payload.error || `The analysis service returned HTTP ${response.status}.`);
          if (response.status < 500) throw Object.assign(error, { retryable: false });
          throw error;
        }
        return payload;
      } catch (error) {
        lastError = error;
        if (error.retryable === false || attempt === retries) break;
        await new Promise(resolve => setTimeout(resolve, 300 * (attempt + 1)));
      }
    }
    throw lastError || new Error("The local analysis service could not be reached.");
  }

  function normalizeUrl(value) {
    const enteredUrl = value.trim();
    if (!enteredUrl) throw new Error("Enter a website URL first.");
    if (/^[a-z][a-z\d+.-]*:\/\//i.test(enteredUrl) && !/^https?:\/\//i.test(enteredUrl)) {
      throw new Error("Only HTTP and HTTPS website URLs are supported.");
    }
    const url = /^https?:\/\//i.test(enteredUrl) ? enteredUrl : `https://${enteredUrl}`;
    try {
      const parsed = new URL(url);
      if (!["http:", "https:"].includes(parsed.protocol)) {
        throw new Error("Only HTTP and HTTPS website URLs are supported.");
      }
      if (parsed.username || parsed.password) {
        throw new Error("URLs containing usernames or passwords are not allowed.");
      }
    } catch (error) {
      throw new Error(error.message || "Enter a valid website URL.");
    }
    return url;
  }

  function analyzePage(doc, pageUrl) {
    const title = doc.querySelector("title")?.textContent.trim() || "Untitled page";
    const description = doc.querySelector('meta[name="description" i]')?.content.trim();
    const headings = [...doc.querySelectorAll("h1, h2, h3, h4, h5, h6")];
    const images = [...doc.querySelectorAll("img")];
    const links = [...doc.querySelectorAll("a[href]")];
    const externalAssets = new Set(
      [...doc.querySelectorAll("img[src], source[src], video[src], audio[src]")]
        .map(node => node.getAttribute("src"))
        .filter(Boolean)
    );
    doc.querySelectorAll("[srcset]").forEach(node => {
      node.getAttribute("srcset").split(",").forEach(item => {
        const asset = item.trim().split(/\s+/)[0];
        if (asset) externalAssets.add(asset);
      });
    });
    const controls = [...doc.querySelectorAll('input:not([type="hidden"]), select, textarea')];
    const headingLevels = headings.map(heading => Number(heading.tagName.slice(1)));
    const skippedHeadingLevels = headingLevels.some((level, index) =>
      index === 0 ? level > 1 : level > headingLevels[index - 1] + 1
    );
    const missingImageAlt = images.filter(image => !image.hasAttribute("alt")).length;
    const unnamedLinks = links.filter(link =>
      !link.textContent.trim() &&
      !link.getAttribute("aria-label") &&
      !link.querySelector("img[alt]")
    ).length;
    const unlabeledControls = controls.filter(control => {
      if (control.labels?.length) return false;
      if (control.getAttribute("aria-label") || control.getAttribute("aria-labelledby")) return false;
      return !control.closest("label");
    }).length;
    const h1Count = doc.querySelectorAll("h1").length;
    const hasDescription = Boolean(description);
    const hasLanguage = Boolean(doc.documentElement.getAttribute("lang")?.trim());
    const hasViewport = Boolean(doc.querySelector('meta[name="viewport"]'));
    const hasMain = Boolean(doc.querySelector("main, [role='main']"));
    const hasNavigation = Boolean(doc.querySelector("nav, [role='navigation']"));
    const checks = [
      [hasDescription, "Meta description is present.", "Meta description is missing."],
      [hasLanguage, "Document language is declared.", "Document language is not declared."],
      [hasViewport, "Responsive viewport is configured.", "Responsive viewport is not configured."],
      [h1Count === 1, `Page has exactly one top-level heading (found ${h1Count}).`, `Page should have exactly one top-level heading (found ${h1Count}).`],
      [!skippedHeadingLevels, "Heading levels follow a sequential outline.", "Heading outline skips one or more levels."],
      [hasMain, "Main content landmark is present.", "Main content landmark is missing."],
      [hasNavigation, "Navigation landmark is present.", "Navigation landmark is missing."],
      [missingImageAlt === 0, `Images missing alt attributes: ${missingImageAlt}.`, `Add alt attributes to ${missingImageAlt} image(s).`],
      [unnamedLinks === 0, `Links without an accessible name: ${unnamedLinks}.`, `Add accessible names to ${unnamedLinks} link(s).`],
      [unlabeledControls === 0, `Form controls without an accessible label: ${unlabeledControls}.`, `Add accessible labels to ${unlabeledControls} form control(s).`]
    ];
    const recommendations = checks
      .filter(([passed]) => !passed)
      .map(([, , message]) => message);
    const clean = value => String(value || "Not provided").replace(/[\r\n]+/g, " ").trim();
    const outline = headings.length
      ? headings.map(heading => `- ${"#".repeat(Number(heading.tagName.slice(1)))} ${clean(heading.textContent)}`).join("\n")
      : "No headings detected.";

    return `# Local page analysis

> Deterministic checks of this single HTML response. This is not a trained AI model, a full browser-rendered audit, or a security scan. No linked pages are crawled.

## Page

- Title: ${clean(title)}
- URL: ${clean(pageUrl)}
- Language: ${clean(doc.documentElement.getAttribute("lang"))}
- Meta description: ${clean(description)}

## Structure

- Headings: ${headings.length}
- Links: ${links.length}
- Images: ${images.length}
- Form controls: ${controls.length}
- Referenced media assets: ${externalAssets.size}
- Inline styles: ${doc.querySelectorAll("style").length}
- Inline scripts: ${doc.querySelectorAll("script:not([src])").length}

### Heading outline

${outline}

## Checks

${checks.map(([passed, passMessage, failMessage]) => `- ${passed ? "PASS" : "REVIEW"} — ${passed ? passMessage : failMessage}`).join("\n")}

## Suggested improvements

${recommendations.length ? recommendations.map(item => `- ${item}`).join("\n") : "No issues were found by these basic checks."}

## Limits

This report only examines the HTML response provided. It does not execute page scripts, inspect rendered layout, fetch external assets, follow links, or infer server-side behavior.
`;
  }

  function safeFileName(name) {
    return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, "-").slice(0, 100) || "site";
  }

  function buildRepository(rawHtml, pageUrl, reportOverride = null) {
    if (!rawHtml.trim()) throw new Error("Paste some HTML or load the demo first.");

    const doc = new DOMParser().parseFromString(rawHtml, "text/html");
    const analysis = analyzePage(doc, pageUrl);
    const styles = [];
    const scripts = [];
    const externalAssets = new Set();

    doc.querySelectorAll("style").forEach(node => {
      if (node.textContent.trim()) styles.push(node.textContent.trim());
      node.remove();
    });
    doc.querySelectorAll("script:not([src])").forEach(node => {
      if (node.textContent.trim()) scripts.push(node.textContent.trim());
      node.remove();
    });
    doc.querySelectorAll("img[src], source[src], video[src], audio[src]").forEach(node => {
      externalAssets.add(node.getAttribute("src"));
    });
    doc.querySelectorAll("[srcset]").forEach(node => {
      node.getAttribute("srcset").split(",").forEach(item => {
        const url = item.trim().split(/\s+/)[0];
        if (url) externalAssets.add(url);
      });
    });

    const urlBase = pageUrl || document.baseURI;
    function resolveUrl(value) {
      if (!value || value.startsWith("data:") || value.startsWith("#")) return value;
      try { return new URL(value, urlBase).href; } catch { return value; }
    }
    doc.querySelectorAll("img[src], source[src], video[src], audio[src]").forEach(node => {
      node.setAttribute("src", resolveUrl(node.getAttribute("src")));
    });
    doc.querySelectorAll("[srcset]").forEach(node => {
      const absolute = node.getAttribute("srcset").split(",").map(item => {
        const parts = item.trim().split(/\s+/);
        parts[0] = resolveUrl(parts[0]);
        return parts.join(" ");
      }).join(", ");
      node.setAttribute("srcset", absolute);
    });
    doc.querySelectorAll("link[rel~='stylesheet'][href], script[src]").forEach(node => {
      const attr = node.tagName.toLowerCase() === "link" ? "href" : "src";
      node.setAttribute(attr, resolveUrl(node.getAttribute(attr)));
    });

    const title = doc.querySelector("title")?.textContent.trim() || "deconstructed-site";
    const name = safeFileName(title.toLowerCase().replace(/\s+/g, "-"));
    const styleText = [
      "/* Extracted inline styles */",
      ...styles,
      styles.length ? "" : "/* No inline styles were found in the source. */"
    ].join("\n\n");
    const scriptText = [
      "/* Extracted inline scripts */",
      ...scripts,
      scripts.length ? "" : "// No inline scripts were found in the source."
    ].join("\n\n");

    const head = doc.querySelector("head") || doc.documentElement;
    const styleLink = doc.createElement("link");
    styleLink.rel = "stylesheet";
    styleLink.href = "styles.css";
    styleLink.id = "deconstructor-styles";
    head.appendChild(styleLink);
    if (doc.body) {
      const scriptLink = doc.createElement("script");
      scriptLink.src = "script.js";
      scriptLink.defer = true;
      doc.body.appendChild(scriptLink);
    }

    const markup = "<!doctype html>\n" + doc.documentElement.outerHTML;
    const assetLines = [...externalAssets].filter(Boolean).map(asset => `- ${resolveUrl(asset)}`);
    const assetText = [
      "# Referenced assets",
      "",
      assetLines.length ? assetLines.join("\n") : "No image or media assets were detected.",
      "",
      "> Assets are referenced by the page but are not downloaded by this prototype."
    ].join("\n");
    const readme = `# ${title}

A local, browser-generated breakdown of the supplied webpage.

## Files

- \`index.html\` — page markup
- \`styles.css\` — extracted inline styles
- \`script.js\` — extracted inline scripts
- \`assets.md\` — detected image and media references
- \`analysis.md\` — local structural and accessibility checks

## Source

${pageUrl ? `Analyzed URL: ${pageUrl}` : "HTML source was pasted into the deconstructor."}

## Notes

This is a structural extraction, not a full website clone. External dependencies, server-side code, and dynamically loaded content may not be included.
`;

    return {
      name,
      files: {
        "index.html": markup,
        "styles.css": styleText,
        "script.js": scriptText,
        "assets.md": assetText,
        "analysis.md": reportOverride || analysis,
        "README.md": readme
      }
    };
  }

  function createWebsiteCopy(rawHtml, pageUrl = "") {
    if (!rawHtml.trim()) {
      throw new Error("Analyze a website first, or paste the page HTML to prepare a copy.");
    }
    if (!pageUrl) {
      throw new Error("Enter the source website URL before preparing a copy so resource links can be preserved.");
    }
    const sourceUrl = normalizeUrl(pageUrl);
    const doc = new DOMParser().parseFromString(rawHtml, "text/html");
    const resolveUrl = value => {
      if (!value || value.startsWith("#") || value.startsWith("data:")) return value;
      try { return new URL(value, sourceUrl).href; } catch { return value; }
    };
    doc.querySelectorAll("[src], link[href], a[href], form[action], video[poster], object[data]").forEach(node => {
      const attribute = node.hasAttribute("src") ? "src"
        : node.hasAttribute("href") ? "href"
          : node.hasAttribute("action") ? "action"
            : node.hasAttribute("poster") ? "poster" : "data";
      node.setAttribute(attribute, resolveUrl(node.getAttribute(attribute)));
    });
    doc.querySelectorAll("[srcset]").forEach(node => {
      const srcset = node.getAttribute("srcset").split(",").map(item => {
        const parts = item.trim().split(/\s+/);
        parts[0] = resolveUrl(parts[0]);
        return parts.join(" ");
      }).join(", ");
      node.setAttribute("srcset", srcset);
    });
    const title = doc.querySelector("title")?.textContent.trim() || "website-copy";
    const name = safeFileName(`${title.toLowerCase().replace(/\s+/g, "-")}-copy`);
    const portableMarkup = "<!doctype html>\n" + doc.documentElement.outerHTML;
    const notes = `# Static website copy\n\nSource: ${sourceUrl}\n\n## Included\n\n- \`index.html\` — fetched page HTML with relative links resolved to the original website\n- \`original-source.html\` — unmodified fetched HTML response\n\n## Important limits\n\nThis is a static source snapshot. It does not include server-side application code, databases, authenticated content, payments, private APIs, API keys, or browser/runtime-only states. External styles, media, and scripts remain hosted by their original providers and may stop working if those resources change or block access.\n\nUse this copy only for a website you own or are authorized to reproduce.\n`;
    return {
      name,
      files: {
        "index.html": portableMarkup,
        "original-source.html": rawHtml,
        "COPYING-NOTES.md": notes
      }
    };
  }

  return {
    request,
    normalizeUrl,
    loadDashboard: async () => Promise.all([
      request("/api/health"),
      request("/api/knowledge"),
      request("/api/history?limit=20")
    ]),
    loadHistory: () => request("/api/history?limit=20"),
    loadMonitors: () => request("/api/monitors"),
    addMonitor: (url, maxPages, intervalHours) => request("/api/monitors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, maxPages, intervalHours })
    }),
    removeMonitor: id => request(`/api/monitors/${encodeURIComponent(id)}`, {
      method: "DELETE"
    }),
    loadHistoryReport: id => request(`/api/analyses/${id}`),
    compareReports: (id, against) => request(`/api/analyses/${id}/compare?against=${encodeURIComponent(against)}`),
    submitAnalysis: (url, maxPages) => request("/api/analyses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, maxPages })
    }),
    getJob: id => request(`/api/jobs/${id}`),
    saveFeedback: (id, usefulness, accuracy) => request(`/api/analyses/${id}/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usefulness, accuracy })
    }),
    analyzeSource: (rawHtml, pageUrl = "") => buildRepository(rawHtml, pageUrl),
    buildRepository,
    createWebsiteCopy
  };
}
