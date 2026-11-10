    const demoSource = `<!doctype html>
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

    const sourceInput = document.getElementById("sourceInput");
    const codeView = document.getElementById("codeView");
    const fileList = document.getElementById("fileList");
    const statusText = document.getElementById("statusText");
    const previewFrame = document.getElementById("previewFrame");
    let files = {};
    let selectedFile = "index.html";
    let previewMode = false;
    let toastTimer;

    function notify(message) {
      const toast = document.getElementById("toast");
      toast.textContent = message;
      toast.classList.add("show");
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toast.classList.remove("show"), 2300);
    }

    function safeFileName(name) {
      return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, "-").slice(0, 100) || "site";
    }

    function buildRepo(rawHtml, pageUrl) {
      if (!rawHtml.trim()) {
        notify("Paste some HTML or load the demo first.");
        return;
      }

      const parser = new DOMParser();
      const doc = parser.parseFromString(rawHtml, "text/html");
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
      const repoName = safeFileName(title.toLowerCase().replace(/\s+/g, "-"));
      document.getElementById("repoName").textContent = repoName;

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

## Source

${pageUrl ? `Analyzed URL: ${pageUrl}` : "HTML source was pasted into the deconstructor."}

## Notes

This is a structural extraction, not a full website clone. External dependencies, server-side code, and dynamically loaded content may not be included.
`;

      files = {
        "index.html": markup,
        "styles.css": styleText,
        "script.js": scriptText,
        "assets.md": assetText,
        "README.md": readme
      };

      selectedFile = "index.html";
      renderFiles();
      showFile(selectedFile);
      statusText.textContent = "Analysis complete";
      document.getElementById("fileCount").textContent = `${Object.keys(files).length} files`;
      if (previewMode) showPreview();
      notify("Repository generated.");
    }

    function renderFiles() {
      const query = document.getElementById("fileSearch").value.toLowerCase();
      fileList.innerHTML = "";
      Object.keys(files)
        .filter(name => name.toLowerCase().includes(query))
        .forEach(name => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "file-item" + (name === selectedFile ? " active" : "");
          button.innerHTML = `<span class="file-icon">${name.endsWith(".html") ? "◇" : name.endsWith(".css") ? "▧" : name.endsWith(".js") ? "⌘" : "≡"}</span><span class="file-name"></span>`;
          button.querySelector(".file-name").textContent = name;
          button.addEventListener("click", () => {
            selectedFile = name;
            previewMode = false;
            previewFrame.style.display = "none";
            codeView.style.display = "block";
            renderFiles();
            showFile(name);
          });
          fileList.appendChild(button);
        });
    }

    function showFile(name) {
      document.getElementById("currentFile").textContent = name;
      codeView.value = files[name] || "";
    }

    function showPreview() {
      if (!files["index.html"]) return;
      previewMode = true;
      codeView.style.display = "none";
      previewFrame.style.display = "block";
      let preview = files["index.html"];
      const css = (files["styles.css"] || "").replace(/<\/style/gi, "<\\/style");
      preview = preview.replace(
        /<link\b[^>]*id=["']deconstructor-styles["'][^>]*>/i,
        `<style>${css}</style>`
      );
      preview = preview.replace(/<script\b[^>]*src=["']script\.js["'][^>]*><\/script>/i, "");
      previewFrame.srcdoc = preview;
    }

    async function fetchUrl(event) {
      event.preventDefault();
      const input = document.getElementById("urlInput");
      const button = document.getElementById("fetchButton");
      let url = input.value.trim();
      if (!url) {
        notify("Enter a website URL first.");
        return;
      }
      if (!/^https?:\/\//i.test(url)) url = "https://" + url;

      button.disabled = true;
      button.textContent = "Fetching…";
      statusText.textContent = "Fetching page";
      try {
        const response = await fetch(url, { mode: "cors", redirect: "follow" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const html = await response.text();
        sourceInput.value = html;
        buildRepo(html, response.url || url);
      } catch (error) {
        statusText.textContent = "Fetch blocked";
        notify("The site blocked browser access. Paste its HTML source instead.");
      } finally {
        button.disabled = false;
        button.textContent = "Analyze URL";
      }
    }

    document.getElementById("demoButton").addEventListener("click", () => {
      sourceInput.value = demoSource;
      buildRepo(demoSource, "");
    });

    document.getElementById("analyzeButton").addEventListener("click", () => {
      buildRepo(sourceInput.value, document.getElementById("urlInput").value.trim());
    });

    document.getElementById("urlForm").addEventListener("submit", fetchUrl);
    document.getElementById("fileSearch").addEventListener("input", renderFiles);

    document.getElementById("previewTab").addEventListener("click", showPreview);
    document.getElementById("codeTab").addEventListener("click", () => {
      previewMode = false;
      previewFrame.style.display = "none";
      codeView.style.display = "block";
      showFile(selectedFile);
    });

    document.getElementById("copyRepoButton").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(files[selectedFile] || "");
        notify(`${selectedFile} copied to clipboard.`);
      } catch {
        codeView.focus();
        codeView.select();
        notify("Select and copy the file contents.");
      }
    });

    document.getElementById("downloadButton").addEventListener("click", () => {
      const content = files[selectedFile];
      if (content == null) return;
      const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = selectedFile;
      link.click();
      URL.revokeObjectURL(link.href);
      notify(`Downloading ${selectedFile}`);
    });

    document.getElementById("exportButton").addEventListener("click", () => {
      const blob = new Blob([JSON.stringify({ name: document.getElementById("repoName").textContent, files }, null, 2)], {
        type: "application/json"
      });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = "deconstructed-repo.json";
      link.click();
      URL.revokeObjectURL(link.href);
      notify("Repository JSON exported.");
    });

    sourceInput.value = demoSource;
    buildRepo(demoSource, "");
