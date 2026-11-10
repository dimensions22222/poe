import { demoSource } from "./model.js";

export class UltronPresenter {
  constructor(model, view) {
    this.model = model;
    this.view = view;
    this.state = {
      files: {},
      selectedFile: "index.html",
      previewMode: false,
      currentAnalysisId: null
    };
  }

  start() {
    this.bindEvents();
    this.view.setCommandAvailability(id => this.loadHistoryReport(id));
    this.view.setupWorkspaceNavigation();
    this.view.element("sourceInput").value = demoSource;
    this.buildRepository(demoSource, "");
    this.loadDashboard();
  }

  bindEvents() {
    this.view.element("demoButton").addEventListener("click", () => {
      this.state.currentAnalysisId = null;
      this.view.element("feedbackButton").disabled = true;
      this.view.element("sourceInput").value = demoSource;
      this.buildRepository(demoSource, "");
    });
    this.view.element("analyzeButton").addEventListener("click", () => {
      this.state.currentAnalysisId = null;
      this.view.element("feedbackButton").disabled = true;
      this.buildRepository(
        this.view.element("sourceInput").value,
        this.view.element("urlInput").value.trim()
      );
    });
    this.view.element("urlForm").addEventListener("submit", event => this.fetchUrl(event));
    this.view.element("fileSearch").addEventListener("input", () => {
      this.view.renderFiles(this.state.files, this.state.selectedFile, name => this.selectFile(name));
    });
    this.view.element("refreshDashboard").addEventListener("click", () => this.loadDashboard());
    this.view.element("retryAnalysis").addEventListener("click", () => {
      this.view.element("urlForm").requestSubmit();
    });
    this.view.element("compareSelect").addEventListener("change", () => {
      this.view.updateCompareAvailability(this.state.currentAnalysisId);
    });
    this.view.element("compareButton").addEventListener("click", () => this.compareReports());
    this.view.element("feedbackForm").addEventListener("submit", event => this.saveFeedback(event));
    this.view.element("previewTab").addEventListener("click", () => this.showPreview());
    this.view.element("codeTab").addEventListener("click", () => this.showCode());
    this.view.element("copyRepoButton").addEventListener("click", () => this.copySelectedFile());
    this.view.element("downloadButton").addEventListener("click", () => this.downloadSelectedFile());
    this.view.element("exportButton").addEventListener("click", () => this.exportRepository());
  }

  async loadDashboard() {
    try {
      const [health, knowledge, history] = await this.model.loadDashboard();
      this.view.renderKnowledge(knowledge);
      this.view.renderHistory(history.history, this.state.currentAnalysisId, id => this.loadHistoryReport(id));
      this.view.setEngineStatus(
        `Local ${health.storage} engine online · rule-based retrieval memory · ${knowledge.stats.activeJobs} active job(s).`
      );
    } catch (error) {
      this.view.setEngineStatus(
        `${error.message} Start the app with npm start, then open http://127.0.0.1:3000.`,
        "error"
      );
    }
  }

  buildRepository(rawHtml, pageUrl, report = null) {
    try {
      const repository = this.model.buildRepository(rawHtml, pageUrl, report);
      this.state.files = repository.files;
      this.state.selectedFile = "index.html";
      this.view.renderRepository(repository, this.state.selectedFile, name => this.selectFile(name));
      this.view.showCode(this.state.selectedFile, this.state.files);
      this.view.setRepositoryStatus("Analysis complete");
      if (this.state.previewMode) this.showPreview();
      this.view.notify("Repository generated.");
    } catch (error) {
      this.view.notify(error.message);
    }
  }

  selectFile(name) {
    this.state.selectedFile = name;
    this.state.previewMode = false;
    this.view.showCode(name, this.state.files);
    this.view.renderFiles(this.state.files, name, file => this.selectFile(file));
  }

  showPreview() {
    this.state.previewMode = true;
    this.view.showPreview(this.state.files);
  }

  showCode() {
    this.state.previewMode = false;
    this.view.showCode(this.state.selectedFile, this.state.files);
  }

  async fetchUrl(event) {
    event.preventDefault();
    let url;
    try {
      url = this.model.normalizeUrl(this.view.element("urlInput").value);
    } catch (error) {
      this.view.notify(error.message);
      return;
    }

    this.state.currentAnalysisId = null;
    this.view.clearForAnalysis();
    this.view.renderWorkflow("validation", 2);
    this.view.setEngineStatus("Submitting URL for public-address and access-policy validation.", "active");
    const button = this.view.element("fetchButton");
    const originalLabel = button.textContent;
    button.disabled = true;
    button.textContent = "Initializing…";
    this.view.setRepositoryStatus("Initializing intelligence core");
    try {
      const job = await this.model.submitAnalysis(url, Number(this.view.element("pageLimit").value));
      this.view.setEngineStatus("Analysis job accepted; checking robots.txt before retrieval.", "active");
      await this.pollAnalysis(job.jobId);
    } catch (error) {
      this.view.renderWorkflow(error.stage || "validation", error.progress || 0, true);
      this.view.setRepositoryStatus("Analysis failed");
      this.view.setEngineStatus(error.message, "error");
      this.view.element("retryAnalysis").hidden = false;
      this.view.notify(error.message);
    } finally {
      button.disabled = false;
      button.textContent = originalLabel;
    }
  }

  async pollAnalysis(jobId) {
    const labels = {
      validation: "Validating public URL",
      robots: "Checking robots.txt",
      retrieval: "Retrieving permitted pages",
      mapping: "Mapping DOM and page structure",
      detection: "Identifying technologies and design patterns",
      comparison: "Comparing with stored patterns",
      storing: "Saving report and learning",
      complete: "Intelligence report generated"
    };
    const startedAt = Date.now();
    while (Date.now() - startedAt < 10 * 60 * 1000) {
      const job = await this.model.getJob(jobId);
      const label = labels[job.stage] || "Analyzing website";
      this.view.renderWorkflow(job.stage, job.progress, job.status === "failed");
      this.view.setRepositoryStatus(label);
      if (job.status === "complete") {
        this.state.currentAnalysisId = job.analysisId;
        this.view.element("retryAnalysis").hidden = true;
        this.view.element("sourceInput").value = job.sourceHtml || "";
        this.view.element("usefulnessRating").value = "";
        this.view.element("accuracyRating").value = "";
        this.view.element("compareSelect").value = "";
        this.buildRepository(job.sourceHtml || "", job.analysis.url, job.report);
        this.view.renderAnalysis(job.analysis, job.report, this.state.currentAnalysisId);
        this.view.renderWorkflow("complete", 100);
        this.view.setRepositoryStatus("Intelligence report generated");
        this.view.setEngineStatus(
          `Analysis complete · ${job.analysis.pageCount} permitted page(s) · ${job.analysis.confidence}% heuristic confidence.`
        );
        await this.loadDashboard();
        return;
      }
      if (job.status === "failed") {
        throw Object.assign(new Error(job.error || "Website analysis failed."), {
          stage: job.stage,
          progress: job.progress
        });
      }
      this.view.setEngineStatus(`${label} · ${job.progress}% complete.`, "active");
      await new Promise(resolve => setTimeout(resolve, 750));
    }
    throw new Error("Analysis is taking longer than expected. Refresh the dashboard to check persisted job status.");
  }

  async loadHistoryReport(analysisId) {
    try {
      const record = await this.model.loadHistoryReport(analysisId);
      this.state.currentAnalysisId = record.id;
      this.view.renderAnalysis(record.analysis, record.report, this.state.currentAnalysisId);
      this.view.element("usefulnessRating").value = record.feedback?.usefulness ?? "";
      this.view.element("accuracyRating").value = record.feedback?.accuracy ?? "";
      this.view.element("comparisonResult").textContent = "";
      this.view.setEngineStatus(`Loaded stored analysis for ${record.title}.`);
      const history = await this.model.loadHistory();
      this.view.renderHistory(history.history, this.state.currentAnalysisId, id => this.loadHistoryReport(id));
    } catch (error) {
      this.view.notify(error.message);
    }
  }

  async compareReports() {
    const against = this.view.element("compareSelect").value;
    if (!this.state.currentAnalysisId || !against) return;
    const button = this.view.element("compareButton");
    button.disabled = true;
    try {
      const result = await this.model.compareReports(this.state.currentAnalysisId, against);
      this.view.renderComparison(result.comparison);
    } catch (error) {
      this.view.notify(error.message);
    } finally {
      this.view.updateCompareAvailability(this.state.currentAnalysisId);
    }
  }

  async saveFeedback(event) {
    event.preventDefault();
    if (!this.state.currentAnalysisId) return;
    const button = this.view.element("feedbackButton");
    button.disabled = true;
    try {
      await this.model.saveFeedback(
        this.state.currentAnalysisId,
        Number(this.view.element("usefulnessRating").value),
        Number(this.view.element("accuracyRating").value)
      );
      this.view.notify("Feedback saved. Similar future findings will use this rating.");
      await this.loadDashboard();
    } catch (error) {
      this.view.notify(error.message);
    } finally {
      button.disabled = !this.state.currentAnalysisId;
    }
  }

  async copySelectedFile() {
    try {
      await navigator.clipboard.writeText(this.state.files[this.state.selectedFile] || "");
      this.view.notify(`${this.state.selectedFile} copied to clipboard.`);
    } catch {
      const codeView = this.view.element("codeView");
      codeView.focus();
      codeView.select();
      this.view.notify("Select and copy the file contents.");
    }
  }

  download(content, fileName, message) {
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(link.href);
    this.view.notify(message);
  }

  downloadSelectedFile() {
    const content = this.state.files[this.state.selectedFile];
    if (content == null) return;
    this.download(content, this.state.selectedFile, `Downloading ${this.state.selectedFile}`);
  }

  exportRepository() {
    const content = JSON.stringify({
      name: this.view.element("repoName").textContent,
      files: this.state.files
    }, null, 2);
    this.download(content, "deconstructed-repo.json", "Repository JSON exported.");
  }
}
