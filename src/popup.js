// Popup entry points.
const runBtn = document.getElementById("runAudit");
const statusEl = document.getElementById("status");
const findingsEl = document.getElementById("findings");
const limitationsEl = document.getElementById("limitations");

runBtn.addEventListener("click", runAudit);

async function runAudit() {
  // Reset previous output before running a new scan.
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

  // Group cards at category level so sections can collapse together.
  const categoryGroups = groupFindingsByCategory(findings);
  const fragment = document.createDocumentFragment();

  categoryGroups.forEach((group, index) => {
    fragment.appendChild(createCategoryGroup(group, index === 0));
  });

  findingsEl.appendChild(fragment);
}

function groupFindingsByCategory(findings) {
  // Build category buckets from grouped findings returned by the content script.
  const groups = new Map();

  for (const finding of findings) {
    const key = finding.category || finding.type || "other";
    const label = finding.categoryLabel || capitalizeWord(key.replace(/[-_]/g, " "));
    const existing = groups.get(key);

    if (!existing) {
      groups.set(key, {
        key,
        label,
        findings: [finding],
        count: finding.count || 1,
        instances: Array.isArray(finding.instances) ? finding.instances.length : 0,
        severity: finding.severity
      });
      continue;
    }

    existing.findings.push(finding);
    existing.count += finding.count || 1;
    existing.instances += Array.isArray(finding.instances) ? finding.instances.length : 0;
    existing.severity = worstSeverity(existing.severity, finding.severity);
  }

  return Array.from(groups.values());
}

function createCategoryGroup(group, defaultOpen) {
  // Each category renders as a collapsible container with nested finding cards.
  const details = document.createElement("details");
  details.className = `category-group severity-${group.severity}`;
  if (defaultOpen) {
    details.open = true;
  }

  const summary = document.createElement("summary");
  summary.className = "category-summary";

  const title = document.createElement("span");
  title.className = "category-title";
  title.textContent = group.label;
  summary.appendChild(title);

  const counts = document.createElement("span");
  counts.className = "category-count";
  counts.textContent = `${group.findings.length} finding${group.findings.length === 1 ? "" : "s"}`;
  summary.appendChild(counts);

  const instanceCount = document.createElement("span");
  instanceCount.className = "category-instance-count";
  instanceCount.textContent = `${group.instances} instance${group.instances === 1 ? "" : "s"}`;
  summary.appendChild(instanceCount);

  const body = document.createElement("div");
  body.className = "category-body";

  for (const finding of group.findings) {
    body.appendChild(createFindingCard(finding));
  }

  details.append(summary, body);
  return details;
}

function createFindingCard(finding) {
  // Each grouped finding stays collapsible to keep details scannable.
  const article = document.createElement("details");
  article.className = `finding severity-${finding.severity}`;
  article.open = true;

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

  const body = document.createElement("div");
  body.className = "finding-body";

  const why = document.createElement("p");
  why.className = "finding-why";
  why.textContent = `Why it matters: ${finding.whyItMatters}`;

  const fix = document.createElement("p");
  fix.className = "finding-fix";
  fix.textContent = `Suggested fix: ${finding.recommendation}`;

  body.append(why, fix);

  const visualPreview = createFixPreview(finding);
  if (visualPreview) {
    body.appendChild(visualPreview);
  }

  if (finding.sample) {
    const sample = document.createElement("p");
    sample.className = "finding-sample";
    sample.textContent = `Example text: \"${finding.sample}\"`;
    body.appendChild(sample);
  }

  const instances = Array.isArray(finding.instances) ? finding.instances : [];
  if (instances.length > 0) {
    body.appendChild(createInstanceDetails(instances));
  }

  article.append(summary, body);
  return article;
}

function renderLimitations(limitations) {
  // Always show at least one reminder about automation limits.
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

function worstSeverity(currentSeverity, nextSeverity) {
  // Bubble category severity to the highest severity seen in that bucket.
  const order = { low: 0, medium: 1, high: 2 };
  return order[nextSeverity] > order[currentSeverity] ? nextSeverity : currentSeverity;
}

function capitalizeWord(text) {
  if (!text) {
    return "Other";
  }

  return text.charAt(0).toUpperCase() + text.slice(1);
}

function createInstanceDetails(instances) {
  // Expanded list of individual elements represented by this grouped finding.
  const details = document.createElement("details");
  details.className = "finding-instances";

  const summary = document.createElement("summary");
  summary.textContent = `View ${instances.length} individual result${instances.length === 1 ? "" : "s"}`;
  details.appendChild(summary);

  const list = document.createElement("ul");
  list.className = "instance-list";

  for (const instance of instances) {
    const item = document.createElement("li");
    item.className = "instance-item";

    if (instance.sample) {
      const sample = document.createElement("p");
      sample.className = "instance-sample";
      sample.textContent = `Text: \"${instance.sample}\"`;
      item.appendChild(sample);
    }

    list.appendChild(item);
  }

  details.appendChild(list);
  return details;
}

function createFixPreview(finding) {
  // Show a compact before/after visual aid for suggested fixes.
  const previewConfig = getPreviewConfig(finding);
  if (!previewConfig) {
    return null;
  }

  const wrapper = document.createElement("div");
  wrapper.className = "fix-preview";

  const label = document.createElement("p");
  label.className = "fix-preview-label";
  label.textContent = "Visual example";
  wrapper.appendChild(label);

  const grid = document.createElement("div");
  grid.className = "fix-preview-grid";

  const before = createPreviewCard("Before", previewConfig.before, finding.sample);
  const after = createPreviewCard("After", previewConfig.after, finding.sample);

  grid.append(before, after);
  wrapper.appendChild(grid);

  return wrapper;
}

function createPreviewCard(titleText, styleConfig, sampleText) {
  // Shared renderer for both preview states.
  const card = document.createElement("div");
  card.className = "preview-card";

  const title = document.createElement("p");
  title.className = "preview-card-title";
  title.textContent = titleText;

  const sample = document.createElement("p");
  sample.className = "preview-text";
  sample.textContent = sampleText || "Readable sample text for low-vision users.";

  applyPreviewStyles(sample, styleConfig);
  card.append(title, sample);

  return card;
}

function applyPreviewStyles(element, styleConfig) {
  // Inline styles keep preview variations local to each card.
  if (styleConfig.color) {
    element.style.color = styleConfig.color;
  }
  if (styleConfig.backgroundColor) {
    element.style.backgroundColor = styleConfig.backgroundColor;
  }
  if (styleConfig.fontSizePx) {
    element.style.fontSize = `${styleConfig.fontSizePx}px`;
  }
  if (styleConfig.lineHeightPx) {
    element.style.lineHeight = `${styleConfig.lineHeightPx}px`;
  }
}

function getPreviewConfig(finding) {
  // Generate preview style pairs for each finding type.
  const details = finding.details || {};

  if (finding.type === "low-contrast-text") {
    return {
      before: {
        color: details.textColor || "rgb(125, 125, 125)",
        backgroundColor: details.backgroundColor || "rgb(175, 175, 175)",
        fontSizePx: details.fontSizePx || 14,
        lineHeightPx: Math.max((details.fontSizePx || 14) * 1.3, 18)
      },
      after: {
        color: details.suggestedTextColor || "rgb(17, 24, 39)",
        backgroundColor: details.backgroundColor || "rgb(175, 175, 175)",
        fontSizePx: details.fontSizePx || 14,
        lineHeightPx: Math.max((details.fontSizePx || 14) * 1.3, 18)
      }
    };
  }

  if (finding.type === "very-small-text" || finding.type === "small-text") {
    const base = details.fontSizePx || (finding.type === "very-small-text" ? 11 : 13);
    return {
      before: {
        color: "rgb(20, 20, 20)",
        backgroundColor: "rgb(250, 247, 241)",
        fontSizePx: base,
        lineHeightPx: Math.max(base * 1.25, 16)
      },
      after: {
        color: "rgb(20, 20, 20)",
        backgroundColor: "rgb(250, 247, 241)",
        fontSizePx: Math.max(16, base + 3),
        lineHeightPx: Math.max(22, (Math.max(16, base + 3)) * 1.4)
      }
    };
  }

  if (finding.type === "tight-line-height") {
    const size = details.fontSizePx || 14;
    const tight = details.lineHeightPx || Math.max(16, size * 1.2);
    return {
      before: {
        color: "rgb(20, 20, 20)",
        backgroundColor: "rgb(250, 247, 241)",
        fontSizePx: size,
        lineHeightPx: tight
      },
      after: {
        color: "rgb(20, 20, 20)",
        backgroundColor: "rgb(250, 247, 241)",
        fontSizePx: size,
        lineHeightPx: Math.max(size * 1.5, tight + 6)
      }
    };
  }

  return null;
}
