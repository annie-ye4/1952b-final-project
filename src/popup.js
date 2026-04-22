// Popup entry points.
const runBtn = document.getElementById("runAudit");
const statusEl = document.getElementById("status");
const findingsEl = document.getElementById("findings");
const limitationsEl = document.getElementById("limitations");
const prioritizeModeEl = document.getElementById("prioritizeMode");
let activeTabId = null;
let latestResults = null;

runBtn.addEventListener("click", runAudit);
prioritizeModeEl.addEventListener("change", () => {
  if (latestResults) {
    renderResults(latestResults);
  }
});

async function runAudit() {
  // Reset previous output before running a new scan.
  setStatus("Scanning current tab...");
  findingsEl.innerHTML = "";

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || typeof tab.id !== "number") {
      throw new Error("Could not find the active tab.");
    }

    activeTabId = tab.id;

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
  latestResults = data;
  const findings = Array.isArray(data.findings) ? data.findings : [];
  findingsEl.innerHTML = "";

  if (findings.length === 0) {
    setStatus("No targeted low-vision issues found in sampled text. This is not a full compliance guarantee.");
    return;
  }

  setStatus(
    `${findings.length} grouped issue${findings.length === 1 ? "" : "s"} found on ${new URL(data.pageUrl).hostname}.`
  );

  // Group cards at category level so sections can collapse together.
  const categoryGroups = groupFindingsByCategory(findings, prioritizeModeEl.checked);
  const fragment = document.createDocumentFragment();

  categoryGroups.forEach((group) => {
    fragment.appendChild(createCategoryGroup(group, false));
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

  const orderedGroups = Array.from(groups.values());
  const prioritize = prioritizeModeEl.checked;

  for (const group of orderedGroups) {
    group.findings.sort((left, right) => compareFindings(left, right, prioritize));
  }

  if (prioritize) {
    orderedGroups.sort((left, right) => {
      const leftTop = left.findings[0] || {};
      const rightTop = right.findings[0] || {};
      return compareFindings(leftTop, rightTop, true);
    });
  }

  return orderedGroups;
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
  fix.textContent = `Suggested fix:\n${formatRecommendationBullets(finding.recommendation)}`;

  body.append(why, fix);

  const wcagBlock = createWcagBlock(finding);
  if (wcagBlock) {
    body.appendChild(wcagBlock);
  }

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

function formatRecommendationBullets(recommendation) {
  const lines = String(recommendation || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return "• No recommendation provided.";
  }

  return lines
    .map((line) => (line.startsWith("•") ? line : `• ${line}`))
    .join("\n");
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

    const showBtn = document.createElement("button");
    showBtn.type = "button";
    showBtn.className = "instance-action";
    showBtn.textContent = "Show on page";
    showBtn.disabled = !canHighlightInstance(instance);
    showBtn.addEventListener("click", () => highlightInstance(showBtn, instance));
    item.appendChild(showBtn);

    list.appendChild(item);
  }

  details.appendChild(list);
  return details;
}

async function highlightInstance(button, instance) {
  if (!activeTabId || !canHighlightInstance(instance)) {
    setStatus("Run the audit again before using Show on page.");
    return;
  }

  const original = button.textContent;
  button.disabled = true;
  button.textContent = "Highlighting...";

  try {
    const response = await chrome.tabs.sendMessage(activeTabId, {
      type: "HIGHLIGHT_AUDIT_TARGET",
      targetId: instance.targetId || "",
      targetSelector: instance.targetSelector,
      sample: instance.sample || ""
    });

    if (!response || !response.ok) {
      throw new Error(response?.error || "Could not highlight element.");
    }

    setStatus("Highlighted element on page.");
    button.textContent = "Highlighted";
    window.setTimeout(() => {
      button.textContent = original;
      button.disabled = !canHighlightInstance(instance);
    }, 900);
  } catch (error) {
    setStatus(`Error: ${error instanceof Error ? error.message : String(error)}`);
    button.textContent = original;
    button.disabled = !canHighlightInstance(instance);
  }
}

function canHighlightInstance(instance) {
  return Boolean(instance && (instance.targetId || instance.targetSelector));
}

function compareFindings(left, right, prioritize) {
  if (!prioritize) {
    return severityRank(right?.severity) - severityRank(left?.severity);
  }

  const impactDelta = getImpactScore(right) - getImpactScore(left);
  if (impactDelta !== 0) {
    return impactDelta;
  }

  return severityRank(right?.severity) - severityRank(left?.severity);
}

function getImpactScore(finding) {
  const severityWeight = severityRank(finding?.severity) + 1;
  const count = typeof finding?.count === "number" && finding.count > 0 ? finding.count : 1;
  const instances = Array.isArray(finding?.instances) ? finding.instances.length : count;
  return severityWeight * Math.max(count, instances);
}

function severityRank(severity) {
  if (severity === "high") {
    return 2;
  }
  if (severity === "medium") {
    return 1;
  }
  return 0;
}

function createWcagBlock(finding) {
  const wcag = finding.wcag || fallbackWcagMapping(finding.type);
  const criteria = Array.isArray(wcag.criteria) ? wcag.criteria.filter(Boolean) : [];

  if (criteria.length === 0 && !wcag.rationale) {
    return null;
  }

  const wrapper = document.createElement("div");
  wrapper.className = "wcag-block";

  if (criteria.length > 0) {
    const criteriaEl = document.createElement("p");
    criteriaEl.className = "wcag-criteria";
    criteriaEl.textContent = `WCAG mapping: ${criteria.join("; ")}`;
    wrapper.appendChild(criteriaEl);
  }

  if (wcag.rationale) {
    const rationaleEl = document.createElement("p");
    rationaleEl.className = "wcag-rationale";
    rationaleEl.textContent = `Rationale: ${wcag.rationale}`;
    wrapper.appendChild(rationaleEl);
  }

  return wrapper;
}

function fallbackWcagMapping(type) {
  if (type === "low-contrast-text" || type === "low-contrast-complex-background") {
    return {
      criteria: ["WCAG 2.2 SC 1.4.3 Contrast (Minimum)"],
      rationale:
        type === "low-contrast-complex-background"
          ? "Image/gradient regions can vary in local contrast, so overlays or text containers are often needed to keep contrast consistently readable."
          : "Contrast requirements preserve text distinguishability for users with reduced contrast sensitivity."
    };
  }

  if (type === "very-small-text" || type === "small-text") {
    return {
      criteria: ["WCAG 2.2 SC 1.4.4 Resize Text", "WCAG 2.2 SC 1.4.10 Reflow"],
      rationale: "Readable base text sizing reduces zoom burden and helps maintain usable layout at 200% zoom."
    };
  }

  if (type === "tight-line-height") {
    return {
      criteria: ["WCAG 2.2 SC 1.4.12 Text Spacing"],
      rationale: "Support for increased line spacing improves line tracking and reduces reading fatigue."
    };
  }

  return { criteria: [], rationale: "" };
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

  if (finding.type === "low-contrast-text" || finding.type === "low-contrast-complex-background") {
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
