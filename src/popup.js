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
    `${findings.length} issue${findings.length === 1 ? "" : "s"} found on ${new URL(data.pageUrl).hostname}.`
  );

  const fragment = document.createDocumentFragment();

  for (const finding of findings) {
    const li = document.createElement("li");
    li.className = `finding severity-${finding.severity}`;

    const title = document.createElement("p");
    title.className = "finding-title";
    title.textContent = finding.summary;

    const severityPill = document.createElement("span");
    severityPill.className = `pill ${finding.severity}`;
    severityPill.textContent = finding.severity;
    title.appendChild(severityPill);

    const meta = document.createElement("p");
    meta.className = "finding-meta";
    meta.textContent = `Where: ${finding.selector}`;

    const why = document.createElement("p");
    why.className = "finding-why";
    why.textContent = `Why it matters: ${finding.whyItMatters}`;

    const fix = document.createElement("p");
    fix.className = "finding-fix";
    fix.textContent = `Suggested fix: ${finding.recommendation}`;

    li.append(title, meta, why, fix);

    if (finding.sample) {
      const sample = document.createElement("p");
      sample.className = "finding-sample";
      sample.textContent = `Text sample: \"${finding.sample}\"`;
      li.appendChild(sample);
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
