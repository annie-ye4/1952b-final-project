const runBtn = document.getElementById("runAudit");
const statusEl = document.getElementById("status");
const findingsEl = document.getElementById("findings");
const limitationsEl = document.getElementById("limitations");

runBtn.addEventListener("click", runAudit);

async function runAudit() {
  setStatus("Scanning current tab...");
  findingsEl.innerHTML = "";

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || typeof tab.id !== "number") {
      throw new Error("Could not find the active tab.");
    }

    const response = await chrome.tabs.sendMessage(tab.id, { type: "RUN_LOW_VISION_AUDIT" });

    if (!response || !response.ok) {
      throw new Error(response?.error || "Audit failed to run.");
    }

    renderResults(response);
    renderLimitations(response.limitations || []);
  } catch (error) {
    setStatus(`Error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function renderResults(data) {
  const findings = Array.isArray(data.findings) ? data.findings : [];

  if (findings.length === 0) {
    setStatus("No targeted low-vision issues found in sampled text. This is not a full compliance guarantee.");
    return;
  }

  setStatus(
    `${findings.length} grouped issue${findings.length === 1 ? "" : "s"} found on ${new URL(data.pageUrl).hostname}.`
  );

  const fragment = document.createDocumentFragment();

  for (const finding of findings) {
    const li = document.createElement("li");
    li.className = `finding severity-${finding.severity}`;

    const details = document.createElement("details");
    details.className = "finding-details";

    const summary = document.createElement("summary");
    summary.className = "finding-summary";

    const title = document.createElement("span");
    title.className = "finding-title";
    title.textContent = finding.summary;
    summary.appendChild(title);

    if (typeof finding.count === "number" && finding.count > 1) {
      const count = document.createElement("span");
      count.className = "pill count";
      count.textContent = `${finding.count} similar`;
      summary.appendChild(count);
    }

    const severityPill = document.createElement("span");
    severityPill.className = `pill ${finding.severity}`;
    severityPill.textContent = finding.severity;
    summary.appendChild(severityPill);

    const summaryHint = document.createElement("span");
    summaryHint.className = "summary-hint";
    summaryHint.textContent = "Expand to inspect matches";
    summary.appendChild(summaryHint);

    details.appendChild(summary);

    const body = document.createElement("div");
    body.className = "finding-body";

    const meta = document.createElement("p");
    meta.className = "finding-meta";
    meta.textContent = `Where: ${finding.selector}`;

    const why = document.createElement("p");
    why.className = "finding-why";
    why.textContent = `Why it matters: ${finding.whyItMatters}`;

    const fix = document.createElement("p");
    fix.className = "finding-fix";
    fix.textContent = `Suggested fix: ${finding.recommendation}`;

    const example = createVisualExample(finding);
    const matches = createMatchList(finding.items || []);

    body.append(meta, why, fix, example, matches);
    details.appendChild(body);
    li.appendChild(details);

    if (finding.sample) {
      const sample = document.createElement("p");
      sample.className = "finding-sample";
      sample.textContent = `Example text: \"${finding.sample}\"`;
      body.appendChild(sample);
    }

    fragment.appendChild(li);
  }

  findingsEl.appendChild(fragment);
}

function renderLimitations(limitations) {
  limitationsEl.innerHTML = "";

  const items = limitations.length
    ? limitations
    : ["Automated checks are limited. Always include manual accessibility testing."];

  for (const limitation of items) {
    const li = document.createElement("li");
    li.textContent = limitation;
    limitationsEl.appendChild(li);
  }
}

function setStatus(message) {
  statusEl.textContent = message;
}

function createVisualExample(finding) {
  const wrap = document.createElement("section");
  wrap.className = "visual-example";

  const label = document.createElement("p");
  label.className = "visual-example-label";
  label.textContent = "Visual fix example";
  wrap.appendChild(label);

  const grid = document.createElement("div");
  grid.className = "visual-example-grid";

  const before = document.createElement("div");
  before.className = `example-card before ${finding.type}`;
  before.appendChild(makeExampleHeading("Before"));
  before.appendChild(makeExamplePreview(finding, false));

  const after = document.createElement("div");
  after.className = `example-card after ${finding.type}`;
  after.appendChild(makeExampleHeading("After"));
  after.appendChild(makeExamplePreview(finding, true));

  grid.append(before, after);
  wrap.appendChild(grid);

  return wrap;
}

function makeExampleHeading(text) {
  const heading = document.createElement("p");
  heading.className = "example-heading";
  heading.textContent = text;
  return heading;
}

function makeExamplePreview(finding, isFixed) {
  const preview = document.createElement("div");
  preview.className = "example-preview";

  const type = finding.type;
  if (type === "low-contrast-text") {
    preview.classList.add(isFixed ? "contrast-fixed" : "contrast-bad");
    preview.textContent = isFixed ? "Readable text on a clear background" : "Hard-to-read text on a weak background";
    return preview;
  }

  if (type === "very-small-text") {
    preview.classList.add(isFixed ? "size-fixed" : "size-bad");
    preview.textContent = isFixed ? "Readable body text at a larger size" : "Tiny text that is difficult to read";
    return preview;
  }

  if (type === "small-text") {
    preview.classList.add(isFixed ? "size-fixed" : "size-bad");
    preview.textContent = isFixed ? "Slightly larger text with better readability" : "Text that is smaller than ideal";
    return preview;
  }

  if (type === "tight-line-height") {
    preview.classList.add(isFixed ? "line-fixed" : "line-bad");
    preview.textContent = isFixed
      ? "This paragraph has more breathing room between lines for easier tracking."
      : "This paragraph is cramped and harder to scan across multiple lines.";
    return preview;
  }

  preview.textContent = isFixed ? "Improved readability after the fix." : "Problematic text before the fix.";
  return preview;
}

function createMatchList(items) {
  const wrap = document.createElement("section");
  wrap.className = "match-list";

  const label = document.createElement("p");
  label.className = "match-list-label";
  label.textContent = `Individual matches (${items.length})`;
  wrap.appendChild(label);

  if (items.length === 0) {
    const empty = document.createElement("p");
    empty.className = "match-empty";
    empty.textContent = "No individual matches were preserved for this group.";
    wrap.appendChild(empty);
    return wrap;
  }

  const list = document.createElement("ul");
  list.className = "match-items";

  for (const item of items) {
    const li = document.createElement("li");
    li.className = "match-item";

    const selector = document.createElement("p");
    selector.className = "match-selector";
    selector.textContent = item.selector;

    const sample = document.createElement("p");
    sample.className = "match-sample";
    sample.textContent = item.sample ? `Sample: ${item.sample}` : "Sample unavailable";

    li.append(selector, sample);
    list.appendChild(li);
  }

  wrap.appendChild(list);
  return wrap;
}
