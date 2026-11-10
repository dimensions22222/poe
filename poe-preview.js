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
    let currentAnalysisId = null;
    let historyCache = [];
    let commandItems = [];
    let commandSelection = 0;
    let commandReturnFocus = null;
    const workflowStages = ["validation", "robots", "retrieval", "mapping", "detection", "comparison", "storing"];
    const workflowLabels = {
      validation: "Validating public URL",
      robots: "Checking robots.txt",
      retrieval: "Retrieving permitted pages",
      mapping: "Mapping DOM and page structure",
      detection: "Identifying technologies and design patterns",
      comparison: "Comparing with stored patterns",
      storing: "Saving report and learning",
      complete: "Intelligence report generated"
    };

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

    async function apiRequest(path, options = {}, retries = 2) {
      let lastError;
      for (let attempt = 0; attempt <= retries; attempt += 1) {
        try {
          const response = await fetch(path, {
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

    function setEngineStatus(message, state = "") {
      const status = document.getElementById("engineStatus");
      status.textContent = message;
      status.dataset.state = state;
      const online = state !== "error";
      document.getElementById("sidebarEngineLabel").textContent = state === "error" ? "Unavailable" : state === "active" ? "Analysis active" : "Operational";
      document.getElementById("sidebarEngineDetail").textContent = state === "error" ? "Check local service" : "Local analysis engine";
      document.getElementById("overviewEngineStatus").textContent = state === "error" ? "Engine unavailable" : state === "active" ? "Analysis in progress" : "Engine operational";
      document.querySelectorAll(".sidebar-footer .connection-indicator, .engine-badge .connection-indicator").forEach(indicator => {
        indicator.classList.toggle("online", online && state !== "active");
        indicator.classList.toggle("busy", state === "active");
        indicator.classList.toggle("error", !online);
      });
    }

    function renderWorkflow(stage, progress = 0, failed = false) {
      const activeIndex = workflowStages.indexOf(stage);
      document.querySelectorAll("#workflow li").forEach((item, index) => {
        item.classList.toggle("complete", stage === "complete" || (activeIndex >= 0 && index < activeIndex));
        item.classList.toggle("active", activeIndex === index && !failed);
        item.classList.toggle("error", activeIndex === index && failed);
      });
      document.getElementById("analysisProgress").style.width = `${Math.max(0, Math.min(100, progress))}%`;
      if (stage === "complete") {
        document.querySelectorAll("#workflow li").forEach(item => item.classList.add("complete"));
      }
    }

    function renderKnowledge(data) {
      const stats = data.stats;
      document.getElementById("statAnalyses").textContent = stats.analyses;
      document.getElementById("statPatterns").textContent = stats.uniquePatterns;
      document.getElementById("statObservations").textContent = stats.observations;
      document.getElementById("statFeedback").textContent = stats.feedbackCount;
      document.getElementById("topbarJobStatus").textContent = stats.activeJobs
        ? `${stats.activeJobs} active ${stats.activeJobs === 1 ? "job" : "jobs"}`
        : "No active jobs";
      document.querySelectorAll(".task-indicator .connection-indicator").forEach(indicator => {
        indicator.classList.toggle("busy", stats.activeJobs > 0);
        indicator.classList.toggle("online", stats.activeJobs === 0);
      });
      const patternList = document.getElementById("patternList");
      patternList.replaceChildren();
      if (!data.patterns.length) {
        const empty = document.createElement("li");
        empty.className = "empty-state";
        empty.textContent = "Patterns are added after a successful URL analysis.";
        patternList.appendChild(empty);
      } else {
        data.patterns.slice(0, 8).forEach(pattern => {
          const item = document.createElement("li");
          const label = document.createElement("span");
          const count = document.createElement("span");
          label.textContent = pattern.label;
          count.textContent = `${pattern.occurrences} observations${pattern.feedbackScore == null ? "" : ` · ${pattern.feedbackScore}/5 feedback`}`;
          item.append(label, count);
          patternList.appendChild(item);
        });
      }
      const activity = document.getElementById("learningActivity");
      activity.replaceChildren();
      const lines = [
        ...data.patterns.slice(0, 3).map(pattern => ({
          label: `Recognized ${pattern.category}: ${pattern.label}`,
          detail: `${pattern.occurrences} stored observation(s)`
        })),
        ...(stats.feedbackCount ? [{
          label: "Feedback incorporated into future relevance ranking",
          detail: `Average rating ${stats.averageFeedback ?? "not available"}/5`
        }] : [])
      ];
      if (!lines.length) lines.push({ label: "No learned observations yet.", detail: "Run an analysis to create the first record." });
      lines.forEach(line => {
        const item = document.createElement("li");
        const label = document.createElement("span");
        const detail = document.createElement("span");
        label.textContent = line.label;
        detail.textContent = line.detail;
        item.append(label, detail);
        activity.appendChild(item);
      });
    }

    function renderHistory(history) {
      historyCache = history;
      const list = document.getElementById("historyList");
      const compareSelect = document.getElementById("compareSelect");
      list.replaceChildren();
      compareSelect.replaceChildren();
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = history.length ? "Select an earlier report" : "No reports to compare";
      compareSelect.appendChild(placeholder);
      if (!history.length) {
        const empty = document.createElement("li");
        empty.className = "empty-state";
        empty.textContent = "No stored analyses yet.";
        list.appendChild(empty);
      }
      history.forEach(item => {
        const row = document.createElement("li");
        const titleWrap = document.createElement("div");
        const open = document.createElement("button");
        const detail = document.createElement("small");
        const option = document.createElement("option");
        open.type = "button";
        open.className = "history-open";
        open.textContent = item.title;
        open.addEventListener("click", () => loadHistoryReport(item.id));
        detail.textContent = `${item.pageCount} page(s) · ${item.confidence}% heuristic confidence · ${new Date(item.createdAt).toLocaleString()}`;
        titleWrap.className = "history-row-title";
        titleWrap.append(open, detail);
        const rating = document.createElement("small");
        rating.textContent = item.feedback ? `Rated ${item.feedback.usefulness}/5` : "Not rated";
        row.append(titleWrap, rating);
        list.appendChild(row);
        if (item.id !== currentAnalysisId) {
          const historyOption = document.createElement("option");
          historyOption.value = item.id;
          historyOption.textContent = `${item.title} — ${new Date(item.createdAt).toLocaleDateString()}`;
          compareSelect.appendChild(historyOption);
        }
      });
      compareSelect.disabled = !currentAnalysisId || history.length < 2;
      document.getElementById("compareButton").disabled = compareSelect.disabled;
    }

    function updateCompareAvailability() {
      const select = document.getElementById("compareSelect");
      document.getElementById("compareButton").disabled = !currentAnalysisId || !select.value;
    }

    async function loadDashboard() {
      try {
        const [health, knowledge, history] = await Promise.all([
          apiRequest("/api/health"),
          apiRequest("/api/knowledge"),
          apiRequest("/api/history?limit=20")
        ]);
        renderKnowledge(knowledge);
        renderHistory(history.history);
        setEngineStatus(`Local ${health.storage} engine online · rule-based retrieval memory · ${knowledge.stats.activeJobs} active job(s).`);
      } catch (error) {
        setEngineStatus(`${error.message} Start the app with npm start, then open http://127.0.0.1:3000.`, "error");
      }
    }

    function renderAnalysis(analysis, report) {
      document.getElementById("reportConfidence").textContent = `${analysis.confidence}% heuristic confidence · ${analysis.pageCount} page(s)`;
      document.getElementById("reportSummary").textContent =
        `${analysis.title} — ${analysis.counts.headings} headings, ${analysis.counts.links} links, ${analysis.counts.images} images, ${analysis.resources.length} distinct linked resources. Memory contains ${analysis.patterns.length} matched design pattern(s).`;
      document.getElementById("reportText").textContent = report;
      const metricLabels = {
        headings: "Headings",
        links: "Links",
        images: "Images",
        formControls: "Form controls",
        stylesheets: "Stylesheets",
        externalScripts: "Scripts",
        externalResources: "External resources"
      };
      const metrics = document.getElementById("reportMetrics");
      metrics.replaceChildren();
      Object.entries(metricLabels).forEach(([key, label]) => {
        const metric = document.createElement("span");
        const value = document.createElement("strong");
        const name = document.createElement("span");
        metric.className = "report-metric";
        value.textContent = analysis.counts[key] ?? 0;
        name.textContent = label;
        metric.append(value, name);
        metrics.appendChild(metric);
      });
      const technologies = document.getElementById("technologyList");
      technologies.replaceChildren();
      if (!analysis.technologies.length) {
        const empty = document.createElement("span");
        empty.className = "empty-state";
        empty.textContent = "No strong technology signatures detected.";
        technologies.appendChild(empty);
      }
      analysis.technologies.forEach(technology => {
        const chip = document.createElement("span");
        chip.className = "technology-chip";
        chip.textContent = `${technology.name} · ${Math.round(technology.confidence * 100)}%`;
        technologies.appendChild(chip);
      });
      const structure = document.getElementById("structureList");
      structure.replaceChildren();
      if (!analysis.headings?.length) {
        const empty = document.createElement("li");
        empty.className = "empty-state";
        empty.textContent = "No headings were detected.";
        structure.appendChild(empty);
      } else {
        analysis.headings.forEach(heading => {
          const item = document.createElement("li");
          item.textContent = `${"#".repeat(heading.level)} ${heading.text}`;
          structure.appendChild(item);
        });
      }
      const designSummary = document.getElementById("designSummary");
      designSummary.textContent = [
        `Palette: ${analysis.palette?.join(", ") || "No inline color tokens observed"}`,
        `Typography: ${analysis.typography?.join("; ") || "No inline font families observed"}`,
        `Responsive media queries: ${analysis.design?.responsiveMediaQueries ?? 0}`,
        `Spacing tokens: ${analysis.design?.spacingTokens?.join(", ") || "No spacing tokens extracted"}`
      ].join(" · ");
      document.getElementById("performanceSummary").textContent =
        `Resource signals: ${analysis.counts.externalResources} external resource(s), ${analysis.counts.externalScripts} script(s), ${analysis.counts.images} image(s). Runtime speed and transferred bytes are not measured.`;
      const resourceList = document.getElementById("resourceList");
      resourceList.replaceChildren();
      const resources = analysis.resources || [];
      if (!resources.length) {
        const empty = document.createElement("li");
        empty.className = "empty-state";
        empty.textContent = "No external resources were identified.";
        resourceList.appendChild(empty);
      } else {
        resources.slice(0, 12).forEach(resource => {
          const item = document.createElement("li");
          item.textContent = `${resource.type}: ${resource.url}${resource.external ? " · external" : ""}`;
          resourceList.appendChild(item);
        });
        if (resources.length > 12) {
          const more = document.createElement("li");
          more.textContent = `${resources.length - 12} more resource(s) are available in the full report.`;
          resourceList.appendChild(more);
        }
      }
      const components = document.getElementById("componentList");
      components.replaceChildren();
      if (!analysis.components?.length) {
        const empty = document.createElement("span");
        empty.className = "empty-state";
        empty.textContent = "No common component patterns detected.";
        components.appendChild(empty);
      } else {
        analysis.components.forEach(component => {
          const chip = document.createElement("span");
          chip.className = "component-chip";
          chip.textContent = component;
          components.appendChild(chip);
        });
      }
      const findings = document.getElementById("findingList");
      findings.replaceChildren();
      analysis.findings.forEach(finding => {
        const item = document.createElement("li");
        const heading = document.createElement("strong");
        const details = document.createElement("p");
        heading.textContent = `${finding.severity.toUpperCase()} · ${finding.title} · ${finding.relevance ?? Math.round(finding.confidence * 100)}% relevance`;
        details.textContent = `${finding.detail} ${finding.recommendation}${finding.history ? ` Historical feedback: ${finding.history.feedbackScore}/5 across ${finding.history.ratings} rating(s).` : ""}`;
        item.append(heading, details);
        findings.appendChild(item);
      });
      document.getElementById("feedbackButton").disabled = !currentAnalysisId;
      document.getElementById("compareSelect").disabled = !currentAnalysisId;
      document.getElementById("compareButton").disabled = !currentAnalysisId;
    }

    async function loadHistoryReport(analysisId) {
      try {
        const record = await apiRequest(`/api/analyses/${analysisId}`);
        currentAnalysisId = record.id;
        renderAnalysis(record.analysis, record.report);
        if (record.feedback) {
          document.getElementById("usefulnessRating").value = record.feedback.usefulness;
          document.getElementById("accuracyRating").value = record.feedback.accuracy;
        } else {
          document.getElementById("usefulnessRating").value = "";
          document.getElementById("accuracyRating").value = "";
        }
        document.getElementById("comparisonResult").textContent = "";
        setEngineStatus(`Loaded stored analysis for ${record.title}.`);
        const history = await apiRequest("/api/history?limit=20");
        renderHistory(history.history);
      } catch (error) {
        notify(error.message);
      }
    }

    async function compareReports() {
      const against = document.getElementById("compareSelect").value;
      if (!currentAnalysisId || !against) return;
      const button = document.getElementById("compareButton");
      button.disabled = true;
      try {
        const result = await apiRequest(`/api/analyses/${currentAnalysisId}/compare?against=${encodeURIComponent(against)}`);
        const comparison = result.comparison;
        const lines = [
          `${comparison.left.title}  →  ${comparison.right.title}`,
          "",
          "Metric changes:"
        ];
        comparison.metrics.forEach(metric => lines.push(`- ${metric.name}: ${metric.left} → ${metric.right} (${metric.change >= 0 ? "+" : ""}${metric.change})`));
        lines.push("", `Added technologies: ${comparison.addedTechnologies.join(", ") || "none"}`);
        lines.push(`Removed technologies: ${comparison.removedTechnologies.join(", ") || "none"}`);
        lines.push(`New patterns: ${comparison.addedPatterns.join(", ") || "none"}`);
        lines.push(`Resolved findings: ${comparison.resolvedFindings.map(item => item.title).join(", ") || "none"}`);
        lines.push(`New findings: ${comparison.addedFindings.map(item => item.title).join(", ") || "none"}`);
        document.getElementById("comparisonResult").textContent = lines.join("\n");
      } catch (error) {
        notify(error.message);
      } finally {
        updateCompareAvailability();
      }
    }

      function openCommandPalette() {
        const dialog = document.getElementById("commandDialog");
        if (dialog.open) return;
        commandReturnFocus = document.activeElement;
        document.getElementById("commandInput").value = "";
        renderCommandResults("");
        dialog.showModal();
        document.getElementById("commandInput").focus();
      }

      function renderCommandResults(query) {
        const results = document.getElementById("commandResults");
        const normalizedQuery = query.trim().toLowerCase();
        commandItems = [
          ...[...document.querySelectorAll("#primaryNav .nav-link")].map(link => ({
            label: link.textContent.trim(),
            detail: "Navigate",
            href: link.getAttribute("href"),
            icon: link.querySelector(".nav-icon")?.textContent || "›"
          })),
          ...historyCache.map(item => ({
            label: item.title,
            detail: `Open analysis · ${new Date(item.createdAt).toLocaleDateString()}`,
            analysisId: item.id,
            icon: "◷"
          }))
        ].filter(item => `${item.label} ${item.detail}`.toLowerCase().includes(normalizedQuery));
        commandSelection = Math.min(commandSelection, Math.max(0, commandItems.length - 1));
        results.replaceChildren();
        if (!commandItems.length) {
          const empty = document.createElement("div");
          empty.className = "command-empty";
          empty.textContent = "No matching pages or analyses.";
          results.appendChild(empty);
          return;
        }
        commandItems.forEach((item, index) => {
          const button = document.createElement("button");
          const icon = document.createElement("span");
          const label = document.createElement("span");
          const detail = document.createElement("small");
          button.type = "button";
          button.className = "command-item";
          button.setAttribute("role", "option");
          button.setAttribute("aria-selected", String(index === commandSelection));
          icon.textContent = item.icon;
          label.textContent = item.label;
          detail.textContent = item.detail;
          button.append(icon, label, detail);
          button.addEventListener("mouseenter", () => {
            commandSelection = index;
            updateCommandSelection();
          });
          button.addEventListener("click", () => executeCommand(item));
          results.appendChild(button);
        });
      }

      function updateCommandSelection() {
        const buttons = [...document.querySelectorAll("#commandResults .command-item")];
        buttons.forEach((button, index) => button.setAttribute("aria-selected", String(index === commandSelection)));
        buttons[commandSelection]?.scrollIntoView({ block: "nearest" });
      }

      function executeCommand(item) {
        document.getElementById("commandDialog").close();
        if (item.analysisId) {
          loadHistoryReport(item.analysisId);
          document.getElementById("history").scrollIntoView({ behavior: "smooth" });
          return;
        }
        const target = document.querySelector(item.href);
        target?.scrollIntoView({ behavior: "smooth", block: "start" });
        setActiveNavigation(item.href.slice(1));
      }

      function setActiveNavigation(section) {
        const link = document.querySelector(`#primaryNav .nav-link[data-section="${section}"]`);
        if (!link) return;
        document.querySelectorAll("#primaryNav .nav-link").forEach(item => item.classList.toggle("active", item === link));
        document.getElementById("currentSectionName").textContent = link.textContent.trim();
      }

      function setupWorkspaceNavigation() {
        const sidebar = document.getElementById("appSidebar");
        const mobileMenuButton = document.getElementById("mobileMenuButton");
        const collapseButton = document.getElementById("sidebarCollapse");
        const closeMobileMenu = () => {
          document.body.classList.remove("nav-open");
          mobileMenuButton.setAttribute("aria-expanded", "false");
          mobileMenuButton.setAttribute("aria-label", "Open navigation");
        };
        document.querySelectorAll("#primaryNav .nav-link").forEach(link => {
          link.title = link.textContent.trim();
          link.addEventListener("click", () => {
            setActiveNavigation(link.dataset.section);
            closeMobileMenu();
          });
        });
        mobileMenuButton.addEventListener("click", () => {
          const open = document.body.classList.toggle("nav-open");
          mobileMenuButton.setAttribute("aria-expanded", String(open));
          mobileMenuButton.setAttribute("aria-label", open ? "Close navigation" : "Open navigation");
        });
        document.getElementById("sidebarBackdrop").addEventListener("click", closeMobileMenu);
        collapseButton.addEventListener("click", () => {
          const compact = window.matchMedia("(max-width: 1080px)").matches;
          const collapsed = compact
            ? !document.body.classList.toggle("sidebar-expanded")
            : document.body.classList.toggle("sidebar-collapsed");
          if (compact) document.body.classList.remove("sidebar-collapsed");
          else document.body.classList.remove("sidebar-expanded");
          try {
            localStorage.setItem("ultron-sidebar-collapsed", String(collapsed));
          } catch {
            notify("Sidebar preference could not be saved.");
          }
          collapseButton.setAttribute("aria-label", collapsed ? "Expand sidebar" : "Collapse sidebar");
          collapseButton.title = collapsed ? "Expand sidebar" : "Collapse sidebar";
        });
        try {
          if (localStorage.getItem("ultron-sidebar-collapsed") === "true") {
            document.body.classList.add("sidebar-collapsed");
            collapseButton.setAttribute("aria-label", "Expand sidebar");
            collapseButton.title = "Expand sidebar";
          }
        } catch {
          console.info("Sidebar preference storage is unavailable.");
        }
        const navSections = [...document.querySelectorAll("#primaryNav .nav-link")];
        const observer = new IntersectionObserver(entries => {
          const visible = entries.filter(entry => entry.isIntersecting).sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0];
          if (visible) setActiveNavigation(visible.target.id);
        }, { rootMargin: "-18% 0px -68% 0px", threshold: [0, .1, .25, .5] });
        navSections.forEach(link => {
          const section = document.querySelector(link.getAttribute("href"));
          if (section) observer.observe(section);
        });
        const dialog = document.getElementById("commandDialog");
        document.getElementById("commandTrigger").addEventListener("click", openCommandPalette);
        document.getElementById("closeCommandDialog").addEventListener("click", () => dialog.close());
        document.getElementById("commandInput").addEventListener("input", event => {
          commandSelection = 0;
          renderCommandResults(event.target.value);
        });
        document.getElementById("commandInput").addEventListener("keydown", event => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            if (!commandItems.length) return;
            const direction = event.key === "ArrowDown" ? 1 : -1;
            commandSelection = (commandSelection + direction + commandItems.length) % commandItems.length;
            updateCommandSelection();
          } else if (event.key === "Enter" && commandItems[commandSelection]) {
            event.preventDefault();
            executeCommand(commandItems[commandSelection]);
          }
        });
        dialog.addEventListener("keydown", event => {
          if (event.key === "Escape") {
            event.preventDefault();
            dialog.close();
          }
        });
        dialog.addEventListener("close", () => commandReturnFocus?.focus());
        document.addEventListener("keydown", event => {
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
            event.preventDefault();
            openCommandPalette();
          } else if (event.key === "Escape") {
            closeMobileMenu();
          }
        });
        sidebar.addEventListener("keydown", event => {
          if (event.key === "Escape") closeMobileMenu();
        });
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

    function buildRepo(rawHtml, pageUrl, reportOverride = null) {
      if (!rawHtml.trim()) {
        notify("Paste some HTML or load the demo first.");
        return;
      }

      const parser = new DOMParser();
      const doc = parser.parseFromString(rawHtml, "text/html");
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
- \`analysis.md\` — local structural and accessibility checks

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
        "analysis.md": reportOverride || analysis,
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
      const enteredUrl = input.value.trim();
      if (!enteredUrl) {
        notify("Enter a website URL first.");
        return;
      }
      const url = /^https?:\/\//i.test(enteredUrl) ? enteredUrl : `https://${enteredUrl}`;
      try {
        const parsed = new URL(url);
        if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Only HTTP and HTTPS website URLs are supported.");
        if (parsed.username || parsed.password) throw new Error("URLs containing usernames or passwords are not allowed.");
      } catch (error) {
        notify(error.message || "Enter a valid website URL.");
        return;
      }
      currentAnalysisId = null;
      document.getElementById("retryAnalysis").hidden = true;
      renderWorkflow("validation", 2);
      document.getElementById("analysisProgress").style.width = "2%";
      document.getElementById("feedbackButton").disabled = true;
      document.getElementById("comparisonResult").textContent = "";
      setEngineStatus("Submitting URL for public-address and access-policy validation.", "active");
      button.disabled = true;
      const originalLabel = button.textContent;
      button.textContent = "Initializing…";
      statusText.textContent = "Initializing intelligence core";
      try {
        const job = await apiRequest("/api/analyses", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url, maxPages: Number(document.getElementById("pageLimit").value) })
        });
        setEngineStatus("Analysis job accepted; checking robots.txt before retrieval.", "active");
        await pollAnalysis(job.jobId);
      } catch (error) {
        renderWorkflow(error.stage || "validation", error.progress || 0, true);
        statusText.textContent = "Analysis failed";
        setEngineStatus(error.message, "error");
        document.getElementById("retryAnalysis").hidden = false;
        notify(error.message);
      } finally {
        button.disabled = false;
        button.textContent = originalLabel;
      }
    }

    async function pollAnalysis(jobId) {
      const startedAt = Date.now();
      while (Date.now() - startedAt < 10 * 60 * 1000) {
        const job = await apiRequest(`/api/jobs/${jobId}`);
        const label = workflowLabels[job.stage] || "Analyzing website";
        renderWorkflow(job.stage, job.progress, job.status === "failed");
        statusText.textContent = label;
        if (job.status === "complete") {
          currentAnalysisId = job.analysisId;
          document.getElementById("retryAnalysis").hidden = true;
          sourceInput.value = job.sourceHtml || "";
          document.getElementById("usefulnessRating").value = "";
          document.getElementById("accuracyRating").value = "";
          document.getElementById("compareSelect").value = "";
          buildRepo(job.sourceHtml || "", job.analysis.url, job.report);
          renderAnalysis(job.analysis, job.report);
          renderWorkflow("complete", 100);
          statusText.textContent = "Intelligence report generated";
          setEngineStatus(`Analysis complete · ${job.analysis.pageCount} permitted page(s) · ${job.analysis.confidence}% heuristic confidence.`, "");
          await loadDashboard();
          return;
        }
        if (job.status === "failed") {
          throw Object.assign(new Error(job.error || "Website analysis failed."), {
            stage: job.stage,
            progress: job.progress
          });
        }
        setEngineStatus(`${label} · ${job.progress}% complete.`, "active");
        await new Promise(resolve => setTimeout(resolve, 750));
      }
      throw new Error("Analysis is taking longer than expected. Refresh the dashboard to check persisted job status.");
    }

    document.getElementById("demoButton").addEventListener("click", () => {
      currentAnalysisId = null;
      document.getElementById("feedbackButton").disabled = true;
      sourceInput.value = demoSource;
      buildRepo(demoSource, "");
    });

    document.getElementById("analyzeButton").addEventListener("click", () => {
      currentAnalysisId = null;
      document.getElementById("feedbackButton").disabled = true;
      buildRepo(sourceInput.value, document.getElementById("urlInput").value.trim());
    });

    document.getElementById("urlForm").addEventListener("submit", fetchUrl);
    document.getElementById("fileSearch").addEventListener("input", renderFiles);
    document.getElementById("refreshDashboard").addEventListener("click", loadDashboard);
    document.getElementById("retryAnalysis").addEventListener("click", () => {
      document.getElementById("urlForm").requestSubmit();
    });
    document.getElementById("compareSelect").addEventListener("change", updateCompareAvailability);
    document.getElementById("compareButton").addEventListener("click", compareReports);
    document.getElementById("feedbackForm").addEventListener("submit", async event => {
      event.preventDefault();
      if (!currentAnalysisId) return;
      const button = document.getElementById("feedbackButton");
      button.disabled = true;
      try {
        await apiRequest(`/api/analyses/${currentAnalysisId}/feedback`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            usefulness: Number(document.getElementById("usefulnessRating").value),
            accuracy: Number(document.getElementById("accuracyRating").value)
          })
        });
        notify("Feedback saved. Similar future findings will use this rating.");
        await loadDashboard();
      } catch (error) {
        notify(error.message);
      } finally {
        button.disabled = !currentAnalysisId;
      }
    });

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

    setupWorkspaceNavigation();
    sourceInput.value = demoSource;
    buildRepo(demoSource, "");
    loadDashboard();
