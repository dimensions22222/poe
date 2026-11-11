export class UltronView {
  [key: string]: any;

  constructor(documentRef = document) {
    this.document = documentRef;
    this.toastTimer = null;
    this.commandItems = [];
    this.commandSelection = 0;
    this.commandReturnFocus = null;
  }

  element(id) {
    const element = this.document.getElementById(id);
    if (!element) throw new Error(`The interface is missing the #${id} element.`);
    return element;
  }

  notify(message) {
    const toast = this.element("toast");
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => toast.classList.remove("show"), 2300);
  }

  setEngineStatus(message, state = "") {
    const status = this.element("engineStatus");
    status.textContent = message;
    status.dataset.state = state;
    const online = state !== "error";
    this.element("sidebarEngineLabel").textContent =
      state === "error" ? "Unavailable" : state === "active" ? "Analysis active" : "Operational";
    this.element("sidebarEngineDetail").textContent =
      state === "error" ? "Check local service" : "Local analysis engine";
    this.element("overviewEngineStatus").textContent =
      state === "error" ? "Engine unavailable" : state === "active" ? "Analysis in progress" : "Engine operational";
    this.document.querySelectorAll(".sidebar-footer .connection-indicator, .engine-badge .connection-indicator")
      .forEach(indicator => {
        indicator.classList.toggle("online", online && state !== "active");
        indicator.classList.toggle("busy", state === "active");
        indicator.classList.toggle("error", !online);
      });
  }

  renderWorkflow(stage, progress = 0, failed = false) {
    const stages = ["validation", "robots", "retrieval", "mapping", "detection", "comparison", "enhancement", "storing"];
    const activeIndex = stages.indexOf(stage);
    this.document.querySelectorAll("#workflow li").forEach((item, index) => {
      item.classList.toggle("complete", stage === "complete" || (activeIndex >= 0 && index < activeIndex));
      item.classList.toggle("active", activeIndex === index && !failed);
      item.classList.toggle("error", activeIndex === index && failed);
    });
    this.element("analysisProgress").style.width = `${Math.max(0, Math.min(100, progress))}%`;
    if (stage === "complete") {
      this.document.querySelectorAll("#workflow li").forEach(item => item.classList.add("complete"));
    }
  }

  renderKnowledge(data) {
    const { stats } = data;
    this.element("statAnalyses").textContent = stats.analyses;
    this.element("statPatterns").textContent = stats.uniquePatterns;
    this.element("statObservations").textContent = stats.observations;
    this.element("statFeedback").textContent = stats.feedbackCount;
    this.element("topbarJobStatus").textContent = stats.activeJobs
      ? `${stats.activeJobs} active ${stats.activeJobs === 1 ? "job" : "jobs"}`
      : "No active jobs";
    this.document.querySelectorAll(".task-indicator .connection-indicator").forEach(indicator => {
      indicator.classList.toggle("busy", stats.activeJobs > 0);
      indicator.classList.toggle("online", stats.activeJobs === 0);
    });

    const patternList = this.element("patternList");
    patternList.replaceChildren();
    if (!data.patterns.length) {
      patternList.appendChild(this.emptyItem("Patterns are added after a successful URL analysis."));
    } else {
      data.patterns.slice(0, 8).forEach(pattern => {
        const item = this.document.createElement("li");
        const label = this.document.createElement("span");
        const count = this.document.createElement("span");
        label.textContent = pattern.label;
        count.textContent = `${pattern.occurrences} observations${pattern.feedbackScore == null ? "" : ` · ${pattern.feedbackScore}/5 feedback`}`;
        item.append(label, count);
        patternList.appendChild(item);
      });
    }

    const activity = this.element("learningActivity");
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
      const item = this.document.createElement("li");
      const label = this.document.createElement("span");
      const detail = this.document.createElement("span");
      label.textContent = line.label;
      detail.textContent = line.detail;
      item.append(label, detail);
      activity.appendChild(item);
    });
  }

  renderHistory(history, currentAnalysisId, onOpen) {
    this.history = history;
    const list = this.element("historyList");
    const compareSelect = this.element("compareSelect");
    list.replaceChildren();
    compareSelect.replaceChildren();
    const placeholder = this.document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = history.length ? "Select an earlier report" : "No reports to compare";
    compareSelect.appendChild(placeholder);

    if (!history.length) list.appendChild(this.emptyItem("No stored analyses yet."));
    history.forEach(item => {
      const row = this.document.createElement("li");
      const titleWrap = this.document.createElement("div");
      const open = this.document.createElement("button");
      const detail = this.document.createElement("small");
      open.type = "button";
      open.className = "history-open";
      open.textContent = item.title;
      open.addEventListener("click", () => onOpen(item.id));
      detail.textContent = `${item.pageCount} page(s) · ${item.confidence}% heuristic confidence · ${new Date(item.createdAt).toLocaleString()}`;
      titleWrap.className = "history-row-title";
      titleWrap.append(open, detail);
      const rating = this.document.createElement("small");
      rating.textContent = item.feedback ? `Rated ${item.feedback.usefulness}/5` : "Not rated";
      row.append(titleWrap, rating);
      list.appendChild(row);
      if (item.id !== currentAnalysisId) {
        const option = this.document.createElement("option");
        option.value = item.id;
        option.textContent = `${item.title} — ${new Date(item.createdAt).toLocaleDateString()}`;
        compareSelect.appendChild(option);
      }
    });
    compareSelect.disabled = !currentAnalysisId || history.length < 2;
    this.element("compareButton").disabled = compareSelect.disabled;
    this.updateCompareAvailability(currentAnalysisId);
  }

  renderMonitors(monitors, onOpen, onRemove) {
    const list = this.element("monitorList");
    list.replaceChildren();
    if (!monitors.length) {
      list.appendChild(this.emptyItem("No websites are being monitored."));
      return;
    }

    monitors.forEach(monitor => {
      const row = this.document.createElement("li");
      const details = this.document.createElement("div");
      const url = this.document.createElement("strong");
      const status = this.document.createElement("small");
      const actions = this.document.createElement("div");
      details.className = "monitor-details";
      actions.className = "monitor-actions";
      url.textContent = monitor.url;
      const interval = monitor.intervalHours === 168
        ? "weekly"
        : monitor.intervalHours === 24
          ? "daily"
          : `every ${monitor.intervalHours} hours`;
      status.textContent = monitor.lastError
        ? `Last check failed: ${monitor.lastError} · Next attempt ${new Date(monitor.nextRunAt).toLocaleString()}`
        : monitor.lastRunAt
          ? `${interval} · Last checked ${new Date(monitor.lastRunAt).toLocaleString()}`
          : `${interval} · First check ${new Date(monitor.nextRunAt).toLocaleString()}`;
      details.append(url, status);
      if (monitor.lastAnalysisId) {
        const open = this.document.createElement("button");
        open.type = "button";
        open.className = "button subtle";
        open.textContent = "Open latest report";
        open.addEventListener("click", () => onOpen(monitor.lastAnalysisId));
        actions.appendChild(open);
      }
      const remove = this.document.createElement("button");
      remove.type = "button";
      remove.className = "button subtle";
      remove.textContent = "Remove";
      remove.setAttribute("aria-label", `Stop monitoring ${monitor.url}`);
      remove.addEventListener("click", () => onRemove(monitor.id));
      actions.appendChild(remove);
      row.append(details, actions);
      list.appendChild(row);
    });
  }

  updateCompareAvailability(currentAnalysisId) {
    const select = this.element("compareSelect");
    this.element("compareButton").disabled = !currentAnalysisId || !select.value;
  }

  renderAnalysis(analysis, report, currentAnalysisId) {
    this.element("reportConfidence").textContent = `${analysis.confidence}% heuristic confidence · ${analysis.pageCount} page(s)`;
    this.element("reportSummary").textContent =
      `${analysis.title} — ${analysis.counts.headings} headings, ${analysis.counts.links} links, ${analysis.counts.images} images, ${analysis.resources.length} distinct linked resources. Memory contains ${analysis.patterns.length} matched design pattern(s).`;
    this.element("reportText").textContent = report;
    const aiEnhancement = analysis.aiEnhancement;
    this.element("aiEnhancementText").textContent =
      aiEnhancement?.status === "complete"
        ? aiEnhancement.text
        : aiEnhancement?.status === "failed"
          ? `AI enhancement unavailable: ${aiEnhancement.message} The deterministic report is still available.`
          : aiEnhancement?.status === "disabled"
            ? "AI enhancement is disabled. Configure OPENAI_API_KEY in the local server environment to enable it."
            : "AI enhancement status is not available for this report.";
    const metricLabels = {
      headings: "Headings",
      links: "Links",
      images: "Images",
      formControls: "Form controls",
      stylesheets: "Stylesheets",
      externalScripts: "Scripts",
      externalResources: "External resources"
    };
    const metrics = this.element("reportMetrics");
    metrics.replaceChildren();
    Object.entries(metricLabels).forEach(([key, label]) => {
      const metric = this.document.createElement("span");
      const value = this.document.createElement("strong");
      const name = this.document.createElement("span");
      metric.className = "report-metric";
      value.textContent = analysis.counts[key] ?? 0;
      name.textContent = label;
      metric.append(value, name);
      metrics.appendChild(metric);
    });

    const technologies = this.element("technologyList");
    technologies.replaceChildren();
    if (!analysis.technologies.length) technologies.appendChild(this.emptyItem("No strong technology signatures detected.", "span"));
    analysis.technologies.forEach(technology => {
      const chip = this.document.createElement("span");
      chip.className = "technology-chip";
      chip.textContent = `${technology.name} · ${Math.round(technology.confidence * 100)}%`;
      technologies.appendChild(chip);
    });

    const structure = this.element("structureList");
    structure.replaceChildren();
    if (!analysis.headings?.length) {
      structure.appendChild(this.emptyItem("No headings were detected."));
    } else {
      analysis.headings.forEach(heading => {
        const item = this.document.createElement("li");
        item.textContent = `${"#".repeat(heading.level)} ${heading.text}`;
        structure.appendChild(item);
      });
    }

    this.element("designSummary").textContent = [
      `Palette: ${analysis.palette?.join(", ") || "No inline color tokens observed"}`,
      `Typography: ${analysis.typography?.join("; ") || "No inline font families observed"}`,
      `Responsive media queries: ${analysis.design?.responsiveMediaQueries ?? 0}`,
      `Spacing tokens: ${analysis.design?.spacingTokens?.join(", ") || "No spacing tokens extracted"}`
    ].join(" · ");
    this.element("performanceSummary").textContent =
      `Resource signals: ${analysis.counts.externalResources} external resource(s), ${analysis.counts.externalScripts} script(s), ${analysis.counts.images} image(s). Runtime speed and transferred bytes are not measured.`;

    const resourceList = this.element("resourceList");
    resourceList.replaceChildren();
    const resources = analysis.resources || [];
    if (!resources.length) {
      resourceList.appendChild(this.emptyItem("No external resources were identified."));
    } else {
      resources.slice(0, 12).forEach(resource => {
        const item = this.document.createElement("li");
        item.textContent = `${resource.type}: ${resource.url}${resource.external ? " · external" : ""}`;
        resourceList.appendChild(item);
      });
      if (resources.length > 12) {
        const more = this.document.createElement("li");
        more.textContent = `${resources.length - 12} more resource(s) are available in the full report.`;
        resourceList.appendChild(more);
      }
    }

    const components = this.element("componentList");
    components.replaceChildren();
    if (!analysis.components?.length) {
      components.appendChild(this.emptyItem("No common component patterns detected.", "span"));
    } else {
      analysis.components.forEach(component => {
        const chip = this.document.createElement("span");
        chip.className = "component-chip";
        chip.textContent = component;
        components.appendChild(chip);
      });
    }

    const findings = this.element("findingList");
    findings.replaceChildren();
    analysis.findings.forEach(finding => {
      const item = this.document.createElement("li");
      const heading = this.document.createElement("strong");
      const details = this.document.createElement("p");
      heading.textContent = `${finding.severity.toUpperCase()} · ${finding.title} · ${finding.relevance ?? Math.round(finding.confidence * 100)}% relevance`;
      details.textContent = `${finding.detail} ${finding.recommendation}${finding.history ? ` Historical feedback: ${finding.history.feedbackScore}/5 across ${finding.history.ratings} rating(s).` : ""}`;
      item.append(heading, details);
      findings.appendChild(item);
    });
    this.element("feedbackButton").disabled = !currentAnalysisId;
    this.element("compareSelect").disabled = !currentAnalysisId;
    this.element("compareButton").disabled = !currentAnalysisId;
  }

  renderComparison(comparison) {
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
    this.element("comparisonResult").textContent = lines.join("\n");
  }

  renderRepository({ name, files }, selectedFile, onSelectFile) {
    this.element("repoName").textContent = name;
    this.element("fileCount").textContent = `${Object.keys(files).length} files`;
    this.renderFiles(files, selectedFile, onSelectFile);
  }

  renderFiles(files, selectedFile, onSelectFile) {
    const query = this.element("fileSearch").value.toLowerCase();
    const fileList = this.element("fileList");
    fileList.replaceChildren();
    Object.keys(files)
      .filter(name => name.toLowerCase().includes(query))
      .forEach(name => {
        const button = this.document.createElement("button");
        const icon = this.document.createElement("span");
        const label = this.document.createElement("span");
        button.type = "button";
        button.className = `file-item${name === selectedFile ? " active" : ""}`;
        icon.className = "file-icon";
        icon.textContent = name.endsWith(".html") ? "◇" : name.endsWith(".css") ? "▧" : name.endsWith(".js") ? "⌘" : "≡";
        label.className = "file-name";
        label.textContent = name;
        button.append(icon, label);
        button.addEventListener("click", () => onSelectFile(name));
        fileList.appendChild(button);
      });
  }

  showFile(name, files) {
    this.element("currentFile").textContent = name;
    this.element("codeView").value = files[name] || "";
  }

  showCode(name, files) {
    this.element("previewFrame").style.display = "none";
    this.element("codeView").style.display = "block";
    this.showFile(name, files);
  }

  showPreview(files) {
    if (!files["index.html"]) return;
    this.element("codeView").style.display = "none";
    const frame = this.element("previewFrame");
    frame.style.display = "block";
    let preview = files["index.html"];
    const css = (files["styles.css"] || "").replace(/<\/style/gi, "<\\/style");
    preview = preview.replace(
      /<link\b[^>]*id=["']deconstructor-styles["'][^>]*>/i,
      `<style>${css}</style>`
    );
    preview = preview.replace(/<script\b[^>]*src=["']script\.js["'][^>]*><\/script>/i, "");
    frame.srcdoc = preview;
  }

  setRepositoryStatus(message) {
    this.element("statusText").textContent = message;
  }

  clearForAnalysis() {
    this.element("retryAnalysis").hidden = true;
    this.element("feedbackButton").disabled = true;
    this.element("comparisonResult").textContent = "";
  }

  setCommandAvailability(onOpenAnalysis) {
    this.onOpenAnalysis = onOpenAnalysis;
  }

  setupWorkspaceNavigation() {
    const sidebar = this.element("appSidebar");
    const mobileMenuButton = this.element("mobileMenuButton");
    const collapseButton = this.element("sidebarCollapse");
    const closeMobileMenu = () => {
      this.document.body.classList.remove("nav-open");
      mobileMenuButton.setAttribute("aria-expanded", "false");
      mobileMenuButton.setAttribute("aria-label", "Open navigation");
    };
    const pageLinks = [...this.document.querySelectorAll("#primaryNav .nav-link")];
    const pageNames = new Set(pageLinks.map(link => link.dataset.section));
    const pageFromHash = () => {
      const page = window.location.hash.slice(1);
      return pageNames.has(page) ? page : "overview";
    };
    const showPage = (page, { scroll = false } = {}) => {
      const selectedPage = pageNames.has(page) ? page : "overview";
      this.document.querySelectorAll(".page-view").forEach(view => {
        view.hidden = view.dataset.page !== selectedPage;
      });
      this.setActiveNavigation(selectedPage);
      if (scroll) window.scrollTo({ top: 0, behavior: "smooth" });
    };
    this.navigateToPage = page => {
      const selectedPage = pageNames.has(page) ? page : "overview";
      if (window.location.hash.slice(1) !== selectedPage) {
        window.location.hash = selectedPage;
      } else {
        showPage(selectedPage, { scroll: true });
      }
    };

    pageLinks.forEach(link => {
      link.title = link.textContent.trim();
      link.addEventListener("click", event => {
        event.preventDefault();
        this.navigateToPage(link.dataset.section);
        closeMobileMenu();
      });
    });
    this.document.querySelectorAll("[data-navigate]").forEach(link => {
      link.addEventListener("click", event => {
        event.preventDefault();
        this.navigateToPage(link.dataset.navigate);
      });
    });
    mobileMenuButton.addEventListener("click", () => {
      const open = this.document.body.classList.toggle("nav-open");
      mobileMenuButton.setAttribute("aria-expanded", String(open));
      mobileMenuButton.setAttribute("aria-label", open ? "Close navigation" : "Open navigation");
    });
    this.element("sidebarBackdrop").addEventListener("click", closeMobileMenu);
    collapseButton.addEventListener("click", () => {
      const compact = window.matchMedia("(max-width: 1080px)").matches;
      const collapsed = compact
        ? !this.document.body.classList.toggle("sidebar-expanded")
        : this.document.body.classList.toggle("sidebar-collapsed");
      if (compact) this.document.body.classList.remove("sidebar-collapsed");
      else this.document.body.classList.remove("sidebar-expanded");
      try {
        localStorage.setItem("ultron-sidebar-collapsed", String(collapsed));
      } catch {
        this.notify("Sidebar preference could not be saved.");
      }
      collapseButton.setAttribute("aria-label", collapsed ? "Expand sidebar" : "Collapse sidebar");
      collapseButton.title = collapsed ? "Expand sidebar" : "Collapse sidebar";
    });
    try {
      if (localStorage.getItem("ultron-sidebar-collapsed") === "true") {
        this.document.body.classList.add("sidebar-collapsed");
        collapseButton.setAttribute("aria-label", "Expand sidebar");
        collapseButton.title = "Expand sidebar";
      }
    } catch {
      console.info("Sidebar preference storage is unavailable.");
    }

    window.addEventListener("hashchange", () => showPage(pageFromHash(), { scroll: true }));
    if (!window.location.hash || !pageNames.has(window.location.hash.slice(1))) {
      history.replaceState(null, "", "#overview");
    }
    showPage(pageFromHash());

    const dialog = this.element("commandDialog");
    this.element("commandTrigger").addEventListener("click", () => this.openCommandPalette());
    this.element("closeCommandDialog").addEventListener("click", () => dialog.close());
    this.element("commandInput").addEventListener("input", event => {
      this.commandSelection = 0;
      this.renderCommandResults(event.target.value);
    });
    this.element("commandInput").addEventListener("keydown", event => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        if (!this.commandItems.length) return;
        const direction = event.key === "ArrowDown" ? 1 : -1;
        this.commandSelection = (this.commandSelection + direction + this.commandItems.length) % this.commandItems.length;
        this.updateCommandSelection();
      } else if (event.key === "Enter" && this.commandItems[this.commandSelection]) {
        event.preventDefault();
        this.executeCommand(this.commandItems[this.commandSelection]);
      }
    });
    dialog.addEventListener("keydown", event => {
      if (event.key === "Escape") {
        event.preventDefault();
        dialog.close();
      }
    });
    dialog.addEventListener("close", () => this.commandReturnFocus?.focus());
    this.document.addEventListener("keydown", event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        this.openCommandPalette();
      } else if (event.key === "Escape") {
        closeMobileMenu();
      }
    });
    sidebar.addEventListener("keydown", event => {
      if (event.key === "Escape") closeMobileMenu();
    });
  }

  openCommandPalette() {
    const dialog = this.element("commandDialog");
    if (dialog.open) return;
    this.commandReturnFocus = this.document.activeElement;
    this.element("commandInput").value = "";
    this.renderCommandResults("");
    dialog.showModal();
    this.element("commandInput").focus();
  }

  renderCommandResults(query) {
    const results = this.element("commandResults");
    const normalizedQuery = query.trim().toLowerCase();
    this.commandItems = [
      ...[...this.document.querySelectorAll("#primaryNav .nav-link")].map(link => ({
        label: link.textContent.trim(),
        detail: "Navigate",
        href: link.getAttribute("href"),
        icon: link.querySelector(".nav-icon")?.textContent || "›"
      })),
      ...(this.history || []).map(item => ({
        label: item.title,
        detail: `Open analysis · ${new Date(item.createdAt).toLocaleDateString()}`,
        analysisId: item.id,
        icon: "◷"
      }))
    ].filter(item => `${item.label} ${item.detail}`.toLowerCase().includes(normalizedQuery));
    this.commandSelection = Math.min(this.commandSelection, Math.max(0, this.commandItems.length - 1));
    results.replaceChildren();
    if (!this.commandItems.length) {
      const empty = this.document.createElement("div");
      empty.className = "command-empty";
      empty.textContent = "No matching pages or analyses.";
      results.appendChild(empty);
      return;
    }
    this.commandItems.forEach((item, index) => {
      const button = this.document.createElement("button");
      const icon = this.document.createElement("span");
      const label = this.document.createElement("span");
      const detail = this.document.createElement("small");
      button.type = "button";
      button.className = "command-item";
      button.setAttribute("role", "option");
      button.setAttribute("aria-selected", String(index === this.commandSelection));
      icon.textContent = item.icon;
      label.textContent = item.label;
      detail.textContent = item.detail;
      button.append(icon, label, detail);
      button.addEventListener("mouseenter", () => {
        this.commandSelection = index;
        this.updateCommandSelection();
      });
      button.addEventListener("click", () => this.executeCommand(item));
      results.appendChild(button);
    });
  }

  updateCommandSelection() {
    const buttons = [...this.document.querySelectorAll("#commandResults .command-item")];
    buttons.forEach((button, index) => button.setAttribute("aria-selected", String(index === this.commandSelection)));
    buttons[this.commandSelection]?.scrollIntoView({ block: "nearest" });
  }

  executeCommand(item) {
    this.element("commandDialog").close();
    if (item.analysisId) {
      this.onOpenAnalysis?.(item.analysisId);
      this.navigateToPage?.("analysis");
      return;
    }
    this.navigateToPage?.(item.href.slice(1));
  }

  setActiveNavigation(section) {
    const link = this.document.querySelector(`#primaryNav .nav-link[data-section="${section}"]`);
    if (!link) return;
    this.document.querySelectorAll("#primaryNav .nav-link")
      .forEach(item => item.classList.toggle("active", item === link));
    this.element("currentSectionName").textContent = link.textContent.trim();
  }

  emptyItem(message, tag = "li") {
    const item = this.document.createElement(tag);
    item.className = "empty-state";
    item.textContent = message;
    return item;
  }
}
