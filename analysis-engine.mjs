import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { parse } from "parse5";

const USER_AGENT = "UnmakeLocalAnalyzer/1.0 (+single-site, robots-aware)";
const MAX_HTML_BYTES = 2 * 1024 * 1024;
const MAX_ROBOTS_BYTES = 128 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 5;

function ipv4Number(address) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null;
  }
  return parts.reduce((value, part) => (value << 8n) | BigInt(part), 0n);
}

function ipv6Groups(address) {
  let value = address.toLowerCase().split("%")[0];
  if (value.includes(".")) {
    const lastColon = value.lastIndexOf(":");
    const ipv4 = ipv4Number(value.slice(lastColon + 1));
    if (ipv4 === null) return null;
    value = `${value.slice(0, lastColon)}:${((ipv4 >> 16n) & 0xffffn).toString(16)}:${(ipv4 & 0xffffn).toString(16)}`;
  }
  const halves = value.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  const groups = [...left, ...Array(missing).fill("0"), ...right].map(part => Number.parseInt(part, 16));
  return groups.length === 8 && groups.every(group => Number.isInteger(group) && group >= 0 && group <= 0xffff)
    ? groups
    : null;
}

export function isPublicAddress(address) {
  const family = net.isIP(address);
  if (family === 4) {
    const value = ipv4Number(address);
    if (value === null) return false;
    const blocked = [
      ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
      ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
      ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
      ["198.51.100.0", 24], ["203.0.113.0", 24], ["168.63.129.16", 32],
      ["224.0.0.0", 4], ["240.0.0.0", 4]
    ];
    return !blocked.some(([subnet, bits]) => {
      const base = ipv4Number(subnet);
      const mask = ((1n << BigInt(bits)) - 1n) << BigInt(32 - bits);
      return (value & mask) === (base & mask);
    });
  }

  if (family !== 6) return false;
  const groups = ipv6Groups(address);
  if (!groups) return false;
  const isMappedIpv4 = groups.slice(0, 5).every(group => group === 0) && groups[5] === 0xffff;
  if (isMappedIpv4) {
    return isPublicAddress(`${groups[6] >> 8}.${groups[6] & 255}.${groups[7] >> 8}.${groups[7] & 255}`);
  }
  const globallyRoutable = groups[0] >= 0x2000 && groups[0] <= 0x3fff;
  const documentation = (groups[0] === 0x2001 && groups[1] === 0x0db8) ||
    (groups[0] === 0x3fff && groups[1] < 0x1000);
  const teredo = groups[0] === 0x2001 && groups[1] === 0;
  const benchmark = groups[0] === 0x2001 && groups[1] === 2 && groups[2] === 0;
  const orchid = groups[0] === 0x2001 && groups[1] === 0x10 && groups[2] < 0x1000;
  const orchidV2 = groups[0] === 0x2001 && groups[1] === 0x20 && groups[2] < 0x1000;
  const sixToFour = groups[0] === 0x2002;
  return globallyRoutable && !documentation && !teredo && !benchmark && !orchid && !orchidV2 && !sixToFour;
}

function isBlockedHostname(hostname) {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return !host ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".test") ||
    host === "metadata.google.internal" ||
    host === "metadata.azure.internal";
}

export function normalizeWebsiteUrl(input) {
  if (typeof input !== "string" || input.length > 2048) {
    throw new Error("Enter a valid website URL (maximum 2,048 characters).");
  }
  let url;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error("Enter a valid absolute website URL, including its http:// or https:// scheme.");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Only HTTP and HTTPS website URLs are supported.");
  }
  if (url.username || url.password) {
    throw new Error("URLs containing usernames or passwords are not allowed.");
  }
  if (url.port && url.port !== (url.protocol === "https:" ? "443" : "80")) {
    throw new Error("Only standard public website ports (80 and 443) are allowed.");
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (isBlockedHostname(hostname)) {
    throw new Error("Local and internal hostnames cannot be analyzed.");
  }
  const family = net.isIP(hostname);
  if (family && !isPublicAddress(hostname)) {
    throw new Error("Private, reserved, and non-routable IP addresses cannot be analyzed.");
  }
  url.hash = "";
  url.username = "";
  url.password = "";
  return url;
}

async function resolvePublicAddresses(hostname) {
  if (isBlockedHostname(hostname)) {
    throw new Error("Local and internal hostnames cannot be analyzed.");
  }
  const family = net.isIP(hostname);
  const addresses = family
    ? [{ address: hostname, family }]
    : await dns.lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(entry => !isPublicAddress(entry.address))) {
    throw new Error("The website resolves to a private, reserved, or non-routable address.");
  }
  return addresses;
}

function requestOnce(url, addresses, maxBytes) {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === "https:" ? https : http;
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    const request = transport.request(url, {
      method: "GET",
      agent: false,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html, text/plain;q=0.9, */*;q=0.1",
        "Accept-Encoding": "identity",
        Connection: "close"
      },
      lookup: (requestedHost, options, callback) => {
        if (requestedHost.toLowerCase() !== hostname.toLowerCase()) {
          callback(new Error("Unexpected DNS lookup host."));
          return;
        }
        if (options?.all) callback(null, addresses);
        else callback(null, addresses[0].address, addresses[0].family);
      },
      servername: net.isIP(hostname) ? undefined : hostname,
      timeout: REQUEST_TIMEOUT_MS
    }, response => {
      const status = response.statusCode || 0;
      const location = response.headers.location;
      const chunks = [];
      let totalBytes = 0;
      response.on("data", chunk => {
        totalBytes += chunk.length;
        if (totalBytes > maxBytes) {
          response.destroy(new Error("The website response exceeded the size limit."));
          return;
        }
        chunks.push(chunk);
      });
      response.on("error", reject);
      response.on("end", () => resolve({
        status,
        headers: response.headers,
        location,
        body: Buffer.concat(chunks).toString("utf8")
      }));
    });
    const hardTimeout = setTimeout(
      () => request.destroy(new Error("The website request exceeded the 10-second limit.")),
      REQUEST_TIMEOUT_MS
    );
    request.on("close", () => clearTimeout(hardTimeout));
    request.on("timeout", () => request.destroy(new Error("The website request timed out.")));
    request.on("error", reject);
    request.end();
  });
}

async function safeGet(inputUrl, maxBytes, redirects = 0, originalHost = null) {
  const url = inputUrl instanceof URL ? inputUrl : normalizeWebsiteUrl(inputUrl);
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (originalHost && hostname !== originalHost) {
    throw new Error("Cross-site redirects are not followed.");
  }
  const addresses = await resolvePublicAddresses(hostname);
  const response = await requestOnce(url, addresses, maxBytes);
  if ([301, 302, 303, 307, 308].includes(response.status) && response.location) {
    if (redirects >= MAX_REDIRECTS) throw new Error("The website exceeded the redirect limit.");
    const next = new URL(response.location, url);
    if (url.protocol === "https:" && next.protocol !== "https:") {
      throw new Error("HTTPS-to-HTTP redirects are not followed.");
    }
    if (next.hostname.replace(/^\[|\]$/g, "").toLowerCase() !== hostname) {
      throw new Error("Cross-site redirects are not followed.");
    }
    return safeGet(normalizeWebsiteUrl(next.href), maxBytes, redirects + 1, hostname);
  }
  return { ...response, url };
}

function getAttribute(node, name) {
  return node.attrs?.find(attribute => attribute.name === name)?.value ?? "";
}

function walk(node, visit) {
  visit(node);
  for (const child of node.childNodes || []) walk(child, visit);
  if (node.content) walk(node.content, visit);
}

function textContent(node) {
  if (node.nodeName === "#text") return node.value || "";
  return (node.childNodes || []).map(textContent).join("");
}

function isElement(node, tagName) {
  return node.tagName === tagName;
}

function elements(root, tagName) {
  const found = [];
  walk(root, node => {
    if (isElement(node, tagName)) found.push(node);
  });
  return found;
}

function hasAttribute(node, name) {
  return node.attrs?.some(attribute => attribute.name === name) || false;
}

function normalizedText(node) {
  return textContent(node).replace(/\s+/g, " ").trim();
}

export function analyzeDocument(html, pageUrl) {
  const document = parse(html);
  const allNodes = [];
  walk(document, node => allNodes.push(node));
  const byTag = tag => allNodes.filter(node => isElement(node, tag));
  const attr = (node, name) => getAttribute(node, name);
  const title = normalizedText(byTag("title")[0]) || "Untitled page";
  let resourceBase = pageUrl;
  const declaredBase = byTag("base").map(node => attr(node, "href")).find(Boolean);
  if (declaredBase) {
    try {
      resourceBase = new URL(declaredBase, pageUrl).href;
    } catch {
      resourceBase = pageUrl;
    }
  }
  const headings = allNodes.filter(node => /^h[1-6]$/.test(node.tagName || ""));
  const headingLevels = headings.map(node => Number(node.tagName[1]));
  const links = byTag("a").filter(node => attr(node, "href"));
  const images = byTag("img");
  const controls = allNodes.filter(node =>
    ["input", "select", "textarea"].includes(node.tagName) &&
    !(node.tagName === "input" && attr(node, "type").toLowerCase() === "hidden")
  );
  const labels = byTag("label");
  const labelFor = new Set(labels.map(node => attr(node, "for")).filter(Boolean));
  const labelledBy = new Set(allNodes.filter(node => attr(node, "id")).map(node => attr(node, "id")));
  const unnamedLinks = links.filter(node =>
    !normalizedText(node) &&
    !attr(node, "aria-label") &&
    !(node.childNodes || []).some(child => isElement(child, "img") && hasAttribute(child, "alt"))
  ).length;
  const unlabeledControls = controls.filter(node => {
    const id = attr(node, "id");
    return !labelFor.has(id) &&
      !attr(node, "aria-label") &&
      !attr(node, "aria-labelledby")?.split(/\s+/).some(value => labelledBy.has(value)) &&
      !labels.some(label => {
        let parent = node.parentNode;
        while (parent) {
          if (parent === label) return true;
          parent = parent.parentNode;
        }
        return false;
      });
  }).length;
  const h1Count = byTag("h1").length;
  const headingSkip = headingLevels.some((level, index) =>
    index === 0 ? level > 1 : level > headingLevels[index - 1] + 1
  );
  const meta = byTag("meta");
  const description = meta.find(node => attr(node, "name").toLowerCase() === "description");
  const viewport = meta.some(node => attr(node, "name").toLowerCase() === "viewport");
  const hasLanguage = Boolean(attr(document.childNodes?.find(node => isElement(node, "html")) || {}, "lang"));
  const mainCount = allNodes.filter(node =>
    node.tagName === "main" || attr(node, "role").toLowerCase() === "main"
  ).length;
  const navigationCount = allNodes.filter(node =>
    node.tagName === "nav" || attr(node, "role").toLowerCase() === "navigation"
  ).length;
  const styles = byTag("style").map(node => textContent(node)).join("\n");
  const inlineStyleAttributes = allNodes.map(node => attr(node, "style")).filter(Boolean);
  const css = `${styles}\n${inlineStyleAttributes.join("\n")}`;
  const styleLinks = byTag("link").filter(node => attr(node, "rel").toLowerCase().split(/\s+/).includes("stylesheet"));
  const scripts = byTag("script");
  const externalScripts = scripts.filter(node => attr(node, "src"));
  const inlineScripts = scripts.filter(node => !attr(node, "src") && normalizedText(node));
  const assets = allNodes.filter(node =>
    ["img", "source", "video", "audio"].includes(node.tagName) && attr(node, "src")
  );
  const srcsets = allNodes.flatMap(node => attr(node, "srcset").split(",").map(value => value.trim().split(/\s+/)[0]).filter(Boolean));
  const resources = [
    ...styleLinks.map(node => ({ type: "stylesheet", url: attr(node, "href") })),
    ...externalScripts.map(node => ({ type: "script", url: attr(node, "src") })),
    ...allNodes.filter(node => node.tagName === "link" && ["icon", "preload", "preconnect", "font"].some(rel => attr(node, "rel").toLowerCase().includes(rel)))
      .map(node => ({ type: attr(node, "as") || attr(node, "rel"), url: attr(node, "href") })),
    ...assets.map(node => ({ type: node.tagName, url: attr(node, "src") })),
    ...allNodes.filter(node => node.tagName === "video" && attr(node, "poster"))
      .map(node => ({ type: "poster image", url: attr(node, "poster") })),
    ...allNodes.filter(node => ["iframe", "embed", "object"].includes(node.tagName) && (attr(node, "src") || attr(node, "data")))
      .map(node => ({ type: node.tagName, url: attr(node, "src") || attr(node, "data") })),
    ...[...css.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi)]
      .map(match => ({ type: "CSS asset", url: match[2].trim() })),
    ...srcsets.map(url => ({ type: "responsive image", url }))
  ].filter(resource => resource.url).map(resource => {
    try {
      const resolved = new URL(resource.url, resourceBase);
      return { ...resource, url: resolved.href, external: resolved.origin !== new URL(pageUrl).origin };
    } catch {
      return { ...resource, external: false };
    }
  });
  const externalCount = resources.filter(resource => resource.external).length;
  const rawLower = html.toLowerCase();
  const technologySignals = [
    ["Next.js", /(?:\/_next\/|__next_data__)/i],
    ["Nuxt", /(?:\/_nuxt\/|__nuxt__)/i],
    ["React", /(?:react(?:dom)?\.production|data-reactroot|__react)/i],
    ["Vue", /(?:vue\.runtime|data-v-[a-f0-9]+)/i],
    ["Angular", /(?:ng-version=|angular\.js)/i],
    ["Svelte", /(?:svelte-[a-z0-9]+|__svelte)/i],
    ["WordPress", /(?:wp-content\/|wp-includes\/|name=["']generator["'][^>]+wordpress)/i],
    ["Shopify", /(?:cdn\.shopify\.com|shopify\.theme)/i],
    ["Webflow", /(?:webflow\.com|data-wf-page)/i],
    ["Bootstrap", /(?:bootstrap(?:\.min)?\.css|class=["'][^"']*\bcontainer-fluid\b)/i],
    ["Tailwind CSS", /(?:tailwindcss|class=["'][^"']*\b(?:flex|grid|text-[a-z]+-\d+)\b)/i],
    ["jQuery", /(?:jquery(?:\.min)?\.js|jquery\.fn)/i]
  ];
  const technologies = technologySignals
    .filter(([, signature]) => signature.test(rawLower))
    .map(([name]) => ({ name, confidence: 0.82, evidence: "Known markup or asset signature found." }));
  const colors = [...new Set(css.match(/#[0-9a-f]{3,8}\b|rgba?\([^)]{1,60}\)|hsla?\([^)]{1,60}\)/gi) || [])]
    .slice(0, 12);
  const fontFamilies = [...new Set(
    [...css.matchAll(/font-family\s*:\s*([^;}]+)/gi)]
      .map(match => match[1].replace(/["']/g, "").trim())
      .filter(Boolean)
  )].slice(0, 8);
  const mediaQueries = (css.match(/@media\b/gi) || []).length;
  const spacingValues = css.match(/(?:margin|padding|gap|row-gap|column-gap)\s*:[^;}]+/gi) || [];
  const spacingTokens = [...new Set(spacingValues.flatMap(value => value.match(/\b\d+(?:\.\d+)?(?:px|rem|em)\b/g) || []))].slice(0, 10);
  const findings = [];
  function addFinding(id, severity, titleText, detail, recommendation, confidence = 0.9) {
    findings.push({ id, severity, title: titleText, detail, recommendation, confidence });
  }

  if (!byTag("title").length || !title.trim()) {
    addFinding("missing-title", "medium", "Page title is missing", "No meaningful document title was found.", "Add a concise, unique <title> element.");
  }
  if (!description || !attr(description, "content").trim()) {
    addFinding("missing-description", "low", "Meta description is missing", "Search engines and link previews may lack a page summary.", "Add a relevant meta description.");
  }
  if (!hasLanguage) {
    addFinding("missing-language", "medium", "Document language is not declared", "Assistive technology cannot reliably infer the page language.", "Set the correct lang attribute on the html element.");
  }
  if (!viewport) {
    addFinding("missing-viewport", "medium", "Responsive viewport is not configured", "Mobile browsers may render the page at a desktop layout width.", "Add a width=device-width viewport meta tag.");
  }
  if (h1Count !== 1) {
    addFinding("h1-count", "medium", "Top-level heading structure needs review", `Found ${h1Count} h1 elements; a clear primary heading is recommended.`, "Use one descriptive h1 for the page's main topic.");
  }
  if (headingSkip) {
    addFinding("heading-order", "low", "Heading outline skips levels", "A heading level jumps over the next expected level.", "Use heading levels in a logical order.");
  }
  const missingAlt = images.filter(node => !hasAttribute(node, "alt")).length;
  if (missingAlt) {
    addFinding("missing-alt", "medium", "Images are missing alt attributes", `${missingAlt} image(s) do not declare alt text.`, "Add descriptive alt text, or alt=\"\" for decorative images.");
  }
  if (unnamedLinks) {
    addFinding("unnamed-links", "medium", "Links may lack accessible names", `${unnamedLinks} link(s) have no text or accessible label.`, "Give each link a meaningful text label or aria-label.");
  }
  if (unlabeledControls) {
    addFinding("unlabeled-controls", "medium", "Form controls may be unlabeled", `${unlabeledControls} form control(s) have no associated label.`, "Associate each control with a visible label or accessible name.");
  }
  if (!mainCount) {
    addFinding("missing-main", "low", "Main content landmark is missing", "A main landmark helps assistive-technology users navigate the page.", "Wrap primary page content in one main element.");
  }
  if (!navigationCount && links.length > 5) {
    addFinding("missing-navigation", "low", "Navigation landmark was not detected", "The page contains several links but no nav element.", "Group primary navigation links in a nav landmark when appropriate.");
  }
  if (images.length > 30 || externalScripts.length > 12 || externalCount > 40) {
    addFinding("resource-weight", "low", "Large resource list may affect load time", `Detected ${images.length} images, ${externalScripts.length} external scripts, and ${externalCount} cross-origin resources.`, "Review image sizes, defer non-critical scripts, and reduce unnecessary third-party requests.", 0.78);
  }
  if (inlineScripts.length > 5) {
    addFinding("inline-scripts", "low", "Many inline scripts detected", `${inlineScripts.length} inline script blocks were found in the initial HTML.`, "Consider bundling application code and deferring non-critical scripts.", 0.75);
  }

  const patterns = [];
  const classNames = new Set(allNodes.flatMap(node => attr(node, "class").split(/\s+/).filter(Boolean)));
  const components = [
    ["hero", "hero-section"],
    ["card", "card-component"],
    ["navbar", "navigation-bar"],
    ["modal", "modal-dialog"],
    ["accordion", "accordion"],
    ["tabs", "tab-navigation"],
    ["breadcrumb", "breadcrumbs"],
    ["carousel", "carousel"],
    ["sidebar", "sidebar-navigation"],
    ["button", "call-to-action"],
    ["btn", "call-to-action"]
  ].filter(([className]) => classNames.has(className)).map(([, pattern]) => pattern);
  if (navigationCount) patterns.push("semantic-navigation");
  if (mainCount) patterns.push("main-content-landmark");
  if (mediaQueries || viewport) patterns.push("responsive-layout");
  if (styleLinks.length || styles) patterns.push("external-or-inline-styles");
  if (scripts.length) patterns.push("javascript-enhanced-page");
  if (byTag("form").length) patterns.push("form-interaction");
  if (images.length) patterns.push("image-led-content");
  if (byTag("header").length || byTag("footer").length) patterns.push("semantic-page-shell");
  patterns.push(...components);
  const confidence = Math.min(0.96, Math.round((0.58 + (headings.length > 0 ? 0.06 : 0) + (technologies.length ? 0.08 : 0) + (styles.length || styleLinks.length ? 0.08 : 0) + (mainCount ? 0.06 : 0) + (navigationCount ? 0.06 : 0)) * 100) / 100);
  const pageHost = new URL(pageUrl).hostname;
  const resolvedResources = resources.map(resource => {
    try {
      return { ...resource, hostname: new URL(resource.url).hostname };
    } catch {
      return { ...resource, hostname: "" };
    }
  });

  return {
    url: pageUrl,
    title,
    description: attr(description || {}, "content"),
    language: getAttribute(document.childNodes?.find(node => isElement(node, "html")) || {}, "lang"),
    counts: {
      headings: headings.length,
      links: links.length,
      images: images.length,
      formControls: controls.length,
      stylesheets: styleLinks.length,
      externalScripts: externalScripts.length,
      inlineScripts: inlineScripts.length,
      externalResources: externalCount,
      forms: byTag("form").length,
      navigationLandmarks: navigationCount,
      mainLandmarks: mainCount
    },
    headingOutline: headings.map(node => ({ level: Number(node.tagName[1]), text: normalizedText(node) })).filter(item => item.text),
    resources: resolvedResources.slice(0, 100),
    technologies,
    patterns,
    components,
    resourceBase,
    palette: colors,
    typography: fontFamilies,
    design: { responsiveMediaQueries: mediaQueries, spacingTokens },
    findings: findings.sort((left, right) =>
      ["high", "medium", "low"].indexOf(left.severity) - ["high", "medium", "low"].indexOf(right.severity)
    ),
    confidence,
    host: pageHost
  };
}

export function parseRobotsRules(text) {
  const groups = [];
  let agents = [];
  let rules = [];
  let crawlDelayMs = 0;
  function save() {
    if (agents.length) groups.push({ agents, rules, crawlDelayMs });
    agents = [];
    rules = [];
    crawlDelayMs = 0;
  }
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.split("#", 1)[0].trim();
    const separator = line.indexOf(":");
    if (!line || separator < 0) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (key === "user-agent") {
      if (rules.length) save();
      agents.push(value.toLowerCase());
    } else if (["allow", "disallow"].includes(key) && agents.length && value) {
      rules.push({ allow: key === "allow", path: value });
    } else if (key === "crawl-delay" && agents.length) {
      const delay = Number(value);
      if (Number.isFinite(delay) && delay >= 0) crawlDelayMs = Math.max(crawlDelayMs, delay * 1000);
    }
  }
  save();
  const exact = groups.filter(group => group.agents.some(agent => agent !== "*" && USER_AGENT.toLowerCase().includes(agent)));
  const selected = exact.length ? exact : groups.filter(group => group.agents.includes("*"));
  const selectedRules = selected.flatMap(group => group.rules);
  selectedRules.crawlDelayMs = Math.max(0, ...selected.map(group => group.crawlDelayMs));
  return selectedRules;
}

export function robotsAllows(url, rules) {
  const path = `${url.pathname}${url.search}`;
  const matches = rules.filter(rule => {
    const anchored = rule.path.endsWith("$");
    const source = anchored ? rule.path.slice(0, -1) : rule.path;
    const escaped = source
      .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*");
    try {
      return new RegExp(`^${escaped}${anchored ? "$" : ""}`).test(path);
    } catch {
      return false;
    }
  }).sort((left, right) => right.path.length - left.path.length);
  return !matches.length || matches[0].allow;
}

async function getRobotsRules(baseUrl) {
  const robotsUrl = new URL("/robots.txt", baseUrl);
  const response = await safeGet(robotsUrl, MAX_ROBOTS_BYTES);
  if (response.status === 404 || response.status === 410) return [];
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`robots.txt could not be checked (HTTP ${response.status}); analysis stopped to respect site access rules.`);
  }
  return parseRobotsRules(response.body);
}

export async function analyzeWebsite({ url: inputUrl, maxPages = 1, onStage = () => {} }) {
  const startUrl = normalizeWebsiteUrl(inputUrl);
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 5) {
    throw new Error("Page limit must be between 1 and 5.");
  }
  onStage({ key: "validation", label: "Validating public URL", progress: 5 });
  const rootHost = startUrl.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  await resolvePublicAddresses(rootHost);
  onStage({ key: "robots", label: "Checking robots.txt", progress: 10 });
  const robotsCache = new Map();
  const firstRules = await getRobotsRules(startUrl);
  robotsCache.set(rootHost, firstRules);

  const queue = [startUrl];
  const queued = new Set([startUrl.href]);
  const visited = new Set();
  const pageResults = [];
  const crawlNotes = [];
  let blockedByRobots = 0;
  while (queue.length && pageResults.length < maxPages) {
    const currentUrl = queue.shift();
    if (!currentUrl || visited.has(currentUrl.href)) continue;
    visited.add(currentUrl.href);
    const rules = robotsCache.get(rootHost) || [];
    if (!robotsAllows(currentUrl, rules)) {
      blockedByRobots += 1;
      continue;
    }
    if (pageResults.length && rules.crawlDelayMs > 0) {
      if (rules.crawlDelayMs > 30_000) {
        crawlNotes.push("Additional pages were not fetched because the robots.txt crawl-delay exceeds the job wait limit.");
        break;
      }
      await new Promise(resolveDelay => setTimeout(resolveDelay, rules.crawlDelayMs));
    }
    onStage({
      key: "retrieval",
      label: `Retrieving page ${pageResults.length + 1}`,
      progress: Math.min(20 + pageResults.length * 12, 65)
    });
    const response = await safeGet(currentUrl, MAX_HTML_BYTES);
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Website returned HTTP ${response.status} for ${currentUrl.pathname || "/"}.`);
    }
    const contentType = String(response.headers["content-type"] || "").toLowerCase();
    if (contentType && !/(text\/html|application\/xhtml\+xml)/.test(contentType)) {
      if (!pageResults.length) throw new Error("The URL did not return an HTML page.");
      continue;
    }
    const finalUrl = response.url.href;
    const page = analyzeDocument(response.body, finalUrl);
    pageResults.push({ ...page, sourceHtml: response.body });
    if (pageResults.length >= maxPages) continue;
    for (const node of elements(parse(response.body), "a")) {
      const href = getAttribute(node, "href");
      if (!href || /^(?:#|mailto:|tel:|javascript:|data:)/i.test(href)) continue;
      try {
        const linked = new URL(href, page.resourceBase);
        linked.hash = "";
        linked.username = "";
        linked.password = "";
        if (!["http:", "https:"].includes(linked.protocol)) continue;
        if (linked.hostname.replace(/^\[|\]$/g, "").toLowerCase() !== rootHost) continue;
        if (linked.port && linked.port !== (linked.protocol === "https:" ? "443" : "80")) continue;
        if (!queued.has(linked.href)) {
          queued.add(linked.href);
          queue.push(linked);
        }
      } catch {
        continue;
      }
    }
  }
  if (!pageResults.length) {
    throw new Error("No crawlable pages were found. Check robots.txt or provide a URL that allows analysis.");
  }
  if (blockedByRobots) {
    crawlNotes.push(`${blockedByRobots} discovered page(s) were not fetched because robots.txt disallows them.`);
  }

  onStage({ key: "mapping", label: "Mapping DOM and page structure", progress: 70 });
  const primary = pageResults[0];
  const countKeys = Object.keys(primary.counts);
  const counts = Object.fromEntries(countKeys.map(key => [
    key,
    pageResults.reduce((total, page) => total + page.counts[key], 0)
  ]));
  const findings = [...new Map(pageResults.flatMap(page => page.findings).map(finding => [
    finding.id,
    {
      ...finding,
      pagesAffected: pageResults.filter(page => page.findings.some(item => item.id === finding.id)).length
    }
  ])).values()];
  const technologies = [...new Map(pageResults.flatMap(page => page.technologies).map(item => [item.name, item])).values()];
  const patterns = [...new Set(pageResults.flatMap(page => page.patterns))];
  const components = [...new Set(pageResults.flatMap(page => page.components))];
  const allResources = [...new Map(pageResults.flatMap(page => page.resources).map(item => [item.url, item])).values()];
  const confidence = Math.round(pageResults.reduce((total, page) => total + page.confidence, 0) / pageResults.length * 100);

  onStage({ key: "detection", label: "Identifying technologies and design patterns", progress: 78 });
  const knowledge = {
    url: primary.url,
    pageCount: pageResults.length,
    pages: pageResults.map(({ url: pageUrl, title: pageTitle, counts: pageCounts }) => ({
      url: pageUrl,
      title: pageTitle,
      counts: pageCounts
    })),
    crawlNotes,
    title: primary.title,
    description: primary.description,
    language: primary.language,
    counts,
    headings: primary.headingOutline,
    technologies,
    patterns,
    components,
    palette: primary.palette,
    typography: primary.typography,
    design: primary.design,
    resources: allResources.slice(0, 100),
    findings,
    confidence,
    sourceHtml: primary.sourceHtml
  };
  onStage({ key: "comparison", label: "Comparing with stored patterns", progress: 88 });
  return knowledge;
}

export function formatAnalysisReport(analysis, knownPatterns = []) {
  const list = values => values.length ? values.map(value => `- ${value}`).join("\n") : "- None identified";
  const findingLines = analysis.findings.length
    ? analysis.findings.map(item =>
      `- ${item.severity.toUpperCase()} (${Math.round(item.confidence * 100)}%): ${item.title} — ${item.detail}\n  Recommendation: ${item.recommendation}`
    ).join("\n")
    : "- No issues found by the deterministic checks.";
  const knownLines = knownPatterns.length
    ? knownPatterns.map(item => `- ${item.label}: observed ${item.occurrences} time(s), feedback score ${item.feedbackScore ?? "not rated"}/5`).join("\n")
    : "- No previously stored matching patterns.";
  return `# Website intelligence report

> Deterministic analysis with persistent, retrieval-based memory. This is not a trained machine-learning model and does not execute website scripts. Confidence is a heuristic evidence-coverage score, not a calibrated probability.

## Overview

- Website: ${analysis.title}
- URL: ${analysis.url}
- Pages analyzed: ${analysis.pageCount}
- Heuristic confidence: ${analysis.confidence}%
- Language: ${analysis.language || "Not declared"}

## Architecture signals

- Technologies: ${analysis.technologies.map(item => `${item.name} (${Math.round(item.confidence * 100)}% signature confidence)`).join(", ") || "No strong framework signatures found"}
- Recognized patterns: ${analysis.patterns.join(", ") || "None"}
- Component signals: ${analysis.components.join(", ") || "No common component class names detected"}
- Structure counts: ${Object.entries(analysis.counts).map(([key, value]) => `${key} ${value}`).join("; ")}
- Heading outline: ${analysis.headings.map(item => `${"#".repeat(item.level)} ${item.text}`).join(" | ") || "No headings"}

## Pages analyzed

${analysis.pages.map(page => `- ${page.title}: ${page.url}`).join("\n")}

${analysis.crawlNotes.length ? `Crawl notes:\n${analysis.crawlNotes.map(note => `- ${note}`).join("\n")}` : ""}

## Design language

- Colors: ${analysis.palette.join(", ") || "No inline color tokens observed"}
- Font families: ${analysis.typography.join("; ") || "No inline font-family declarations observed"}
- Responsive media queries: ${analysis.design.responsiveMediaQueries}
- Spacing tokens: ${analysis.design.spacingTokens.join(", ") || "No spacing tokens extracted"}

## Resources

${analysis.resources.slice(0, 30).map(item => `- ${item.type}: ${item.url}${item.external ? " (external)" : ""}`).join("\n") || "- No linked resources detected"}

## Findings

${findingLines}

## Related stored knowledge

${knownLines}

## Crawl and safety limits

At most five same-host pages are fetched. The crawler obeys robots.txt, revalidates DNS at every request and redirect, blocks private/reserved IP ranges, and limits response size and request time. JavaScript is never executed; findings describe the retrieved HTML, not a fully rendered page.
`;
}
