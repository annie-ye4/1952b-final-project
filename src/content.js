(() => {
  let activeHighlightCleanup = null;
  const auditTargets = new Map();
  let auditTargetCounter = 0;

  // Messages shown in the popup to explain scanner scope and caveats.
  const LIMITATIONS = [
    "Automated checks cannot understand design intent, reading order quality, or whether content is truly understandable.",
    "Color contrast results may be approximate when gradients, images, overlays, transparency, or animations are involved.",
    "This tool focuses on low-vision readability signals only; it does not cover all disability needs or all WCAG success criteria.",
    "Manual testing with zoom, high-contrast modes, and assistive tech is still required."
  ];

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || !message.type) {
      return;
    }

    if (message.type === "RUN_LOW_VISION_AUDIT") {
      try {
        const findings = runLowVisionAudit();
        sendResponse({
          ok: true,
          impairmentFocus: "Low vision (contrast sensitivity/readability)",
          findings,
          limitations: LIMITATIONS,
          scannedAt: new Date().toISOString(),
          pageTitle: document.title || "Untitled page",
          pageUrl: location.href
        });
      } catch (error) {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          limitations: LIMITATIONS
        });
      }

      return true;
    }

    if (message.type === "HIGHLIGHT_AUDIT_TARGET") {
      const target = findHighlightTarget(message.targetId, message.targetSelector, message.sample);
      if (!target) {
        sendResponse({ ok: false, error: "Could not locate that element on the current page." });
        return true;
      }

      highlightElement(target);
      sendResponse({ ok: true });
      return true;
    }
  });

  function runLowVisionAudit() {
    // Sample visible text blocks, then evaluate readability-related rules.
    auditTargets.clear();
    auditTargetCounter = 0;
    const textSamples = collectVisibleTextSamples(800);
    const findings = [];

    for (const sample of textSamples) {
      const { element, text, fontSizePx, lineHeightPx, fontWeight, color, backgroundColor, complexBackground } = sample;
      const ratio = contrastRatio(color, backgroundColor);
      const largeText = isLargeText(fontSizePx, fontWeight);
      const threshold = largeText ? 3.0 : 4.5;

      if (ratio < threshold) {
        const suggestedTextColor = suggestReadableTextColor(backgroundColor, threshold);
        const isComplexContrast = Boolean(complexBackground && complexBackground.isComplex);
        findings.push({
          type: isComplexContrast ? "low-contrast-complex-background" : "low-contrast-text",
          category: "contrast",
          categoryLabel: "Contrast",
          subtype: isComplexContrast ? "text-on-image-or-gradient" : "standard-background",
          severity: ratio < threshold - 1 ? "high" : "medium",
          summary: isComplexContrast
            ? "Text over image/gradient appears below recommended contrast (approximate)."
            : "Text contrast is below recommended minimum for low-vision readability.",
          whyItMatters:
            "People with low vision or reduced contrast sensitivity may struggle to distinguish text from its background, especially on bright screens or in glare.",
          recommendation: isComplexContrast
            ? `Contrast ratio ${threshold}:1 required, but this measurement is approximate because the background is image/gradient-based\n• Find: Check CSS background-image/gradient on this region and any overlays\n• Stabilize: Add a solid overlay behind text (for example rgba(255,255,255,0.88) or rgba(0,0,0,0.55))\n• Fix example: .hero-copy { background: rgba(0,0,0,0.58); color: #fff; }\n• Verify: Test multiple points of the image because contrast may vary across the surface`
            : `Contrast ratio ${threshold}:1 required (brighter color must be ${threshold}x luminance of darker)\n• Find: Search styles.css or inline <style> for text/background colors\n• Audit: Use WebAIM Contrast Checker or axe DevTools to verify\n• Fix example: Change #888 text → #333 (dark text on light bg) or #fff text → #000 bg\n• Maintainable: Use CSS variables --text-primary: #1a1a1a; --bg-light: #ffffff;`,
          selector: shortSelector(element),
          targetId: registerAuditTarget(element),
          targetSelector: buildTargetSelector(element),
          sample: trimSample(text),
          wcag: getWcagMapping(isComplexContrast ? "low-contrast-complex-background" : "low-contrast-text", { largeText }),
          details: {
            contrastRatio: Number(ratio.toFixed(2)),
            requiredRatio: threshold,
            fontSizePx: Number(fontSizePx.toFixed(2)),
            textColor: colorToCss(color),
            backgroundColor: colorToCss(backgroundColor),
            suggestedTextColor,
            complexBackground: Boolean(complexBackground && complexBackground.isComplex),
            complexBackgroundReason: complexBackground?.reason || ""
          }
        });
      }

      if (fontSizePx < 12) {
        findings.push({
          type: "very-small-text",
          category: "text-size",
          categoryLabel: "Text size",
          severity: "high",
          summary: "Very small text detected.",
          whyItMatters:
            "Very small text can be unreadable for many low-vision users, even before zooming or magnification is applied.",
          recommendation: "Find font-size in styles.css or inline styles and increase to 16px+\n• Use relative units: rem (recommended) or em for scaling\n• Code: body { font-size: 16px; } then p { font-size: 1rem; } h1 { font-size: 2rem; }\n• Why: Respects user's default font-size preference and browser zoom\n• Test: Zoom to 200% to verify readability",
          selector: shortSelector(element),
          targetId: registerAuditTarget(element),
          targetSelector: buildTargetSelector(element),
          sample: trimSample(text),
          wcag: getWcagMapping("very-small-text"),
          details: {
            fontSizePx: Number(fontSizePx.toFixed(2))
          }
        });
      } else if (fontSizePx < 14) {
        findings.push({
          type: "small-text",
          category: "text-size",
          categoryLabel: "Text size",
          severity: "medium",
          summary: "Small text may reduce readability.",
          whyItMatters:
            "Low-vision users often need larger text to maintain speed and accuracy while reading.",
          recommendation: "Increase font-size to 14px or larger in styles.css\n• Use rem/em units: font-size: 0.875rem → font-size: 1rem\n• Find: Search styles.css for the element's class name or tag\n• Why: Low-vision users need larger text to maintain reading speed\n• Test: Zoom to 200% to ensure layout doesn't break",
          selector: shortSelector(element),
          targetId: registerAuditTarget(element),
          targetSelector: buildTargetSelector(element),
          sample: trimSample(text),
          wcag: getWcagMapping("small-text"),
          details: {
            fontSizePx: Number(fontSizePx.toFixed(2))
          }
        });
      }

      if (text.length > 80 && lineHeightPx > 0 && lineHeightPx < fontSizePx * 1.3) {
        findings.push({
          type: "tight-line-height",
          category: "spacing",
          categoryLabel: "Spacing",
          severity: "medium",
          summary: "Line height is tight for a long text block.",
          whyItMatters:
            "Crowded lines can make tracking from one line to the next difficult, particularly for low-vision readers.",
          recommendation: "Increase line-height in styles.css to 1.5 or higher\n• What it is: Line-height 1.5 = 50% extra space between lines (1.5x the text height)\n• Code example: p { line-height: 1.6; } or p { line-height: 24px; }\n• Helps: Eyes can track across long lines without skipping or losing place\n• Also check: Ensure letter-spacing is normal (not negative/compressed)",
          selector: shortSelector(element),
          targetId: registerAuditTarget(element),
          targetSelector: buildTargetSelector(element),
          sample: trimSample(text),
          wcag: getWcagMapping("tight-line-height"),
          details: {
            fontSizePx: Number(fontSizePx.toFixed(2)),
            lineHeightPx: Number(lineHeightPx.toFixed(2))
          }
        });
      }
    }

    return groupFindings(findings).slice(0, 150);
  }

  function collectVisibleTextSamples(maxCount) {
    // Iterate text nodes and promote them to block-like containers for stable sampling.
    const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
    const samples = [];
    const seenElements = new Set();

    while (walker.nextNode() && samples.length < maxCount) {
      const node = walker.currentNode;
      const raw = node.textContent || "";
      const text = raw.replace(/\s+/g, " ").trim();
      if (text.length < 3) {
        continue;
      }

      const element = node.parentElement;
      if (!element || !isEligibleTextContainer(element) || !isVisible(element)) {
        continue;
      }

      const sampleElement = getSampleElement(element);
      if (!sampleElement || seenElements.has(sampleElement)) {
        continue;
      }

      seenElements.add(sampleElement);

      const style = getComputedStyle(sampleElement);
      const fontSizePx = parsePx(style.fontSize);
      const lineHeightPx = parseLineHeightPx(style.lineHeight, fontSizePx);
      const fontWeight = parseFontWeight(style.fontWeight);
      const color = parseCssColor(style.color);
      const backgroundColor = resolveEffectiveBackgroundColor(sampleElement);
      const complexBackground = detectComplexBackground(sampleElement);

      if (!color || !backgroundColor || fontSizePx <= 0) {
        continue;
      }

      samples.push({
        element: sampleElement,
        text: getVisibleText(sampleElement),
        fontSizePx,
        lineHeightPx,
        fontWeight,
        color,
        backgroundColor,
        complexBackground
      });
    }

    return samples;
  }

  function isEligibleTextContainer(element) {
    const tag = element.tagName.toLowerCase();
    return !["script", "style", "noscript", "svg", "canvas", "code", "pre"].includes(tag);
  }

  function isVisible(element) {
    // Quick visibility gate to avoid hidden/off-layout nodes.
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return false;
    }

    return true;
  }

  function parsePx(value) {
    if (!value) {
      return 0;
    }
    if (value.endsWith("px")) {
      return Number.parseFloat(value) || 0;
    }
    return Number.parseFloat(value) || 0;
  }

  function parseLineHeightPx(lineHeight, fontSizePx) {
    if (!lineHeight || lineHeight === "normal") {
      return fontSizePx * 1.2;
    }
    if (lineHeight.endsWith("px")) {
      return Number.parseFloat(lineHeight) || fontSizePx * 1.2;
    }
    const numeric = Number.parseFloat(lineHeight);
    if (!Number.isNaN(numeric)) {
      return numeric * fontSizePx;
    }
    return fontSizePx * 1.2;
  }

  function parseFontWeight(weight) {
    const numeric = Number.parseInt(String(weight), 10);
    if (!Number.isNaN(numeric)) {
      return numeric;
    }
    return String(weight).toLowerCase() === "bold" ? 700 : 400;
  }

  function parseCssColor(value) {
    if (!value) {
      return null;
    }

    const rgbMatch = value.match(/rgba?\(([^)]+)\)/i);
    if (!rgbMatch) {
      return null;
    }

    const parts = rgbMatch[1].split(",").map((part) => part.trim());
    if (parts.length < 3) {
      return null;
    }

    const r = Number.parseFloat(parts[0]);
    const g = Number.parseFloat(parts[1]);
    const b = Number.parseFloat(parts[2]);
    const a = parts.length > 3 ? Number.parseFloat(parts[3]) : 1;

    if ([r, g, b].some((n) => Number.isNaN(n))) {
      return null;
    }

    return { r, g, b, a: Number.isNaN(a) ? 1 : a };
  }

  function resolveEffectiveBackgroundColor(element) {
    // Walk up ancestors and alpha-composite backgrounds into a final color.
    let current = element;
    let color = { r: 255, g: 255, b: 255, a: 1 };

    while (current && current !== document.documentElement) {
      const bg = parseCssColor(getComputedStyle(current).backgroundColor);
      if (bg && bg.a > 0) {
        color = compositeColors(bg, color);
        if (color.a >= 0.99) {
          break;
        }
      }
      current = current.parentElement;
    }

    return { r: color.r, g: color.g, b: color.b, a: 1 };
  }

  function detectComplexBackground(element) {
    let current = element;

    while (current && current !== document.documentElement) {
      const style = getComputedStyle(current);
      const backgroundImage = style.backgroundImage || "none";

      if (backgroundImage !== "none") {
        const lowered = backgroundImage.toLowerCase();
        if (lowered.includes("gradient(")) {
          return { isComplex: true, reason: "gradient background" };
        }
        if (lowered.includes("url(")) {
          return { isComplex: true, reason: "image background" };
        }
        return { isComplex: true, reason: "non-solid background image" };
      }

      current = current.parentElement;
    }

    return { isComplex: false, reason: "solid background" };
  }

  function compositeColors(foreground, background) {
    const fgA = clamp01(foreground.a);
    const bgA = clamp01(background.a);
    const outA = fgA + bgA * (1 - fgA);

    if (outA <= 0) {
      return { r: 255, g: 255, b: 255, a: 0 };
    }

    return {
      r: (foreground.r * fgA + background.r * bgA * (1 - fgA)) / outA,
      g: (foreground.g * fgA + background.g * bgA * (1 - fgA)) / outA,
      b: (foreground.b * fgA + background.b * bgA * (1 - fgA)) / outA,
      a: outA
    };
  }

  function clamp01(value) {
    return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 1));
  }

  function isLargeText(fontSizePx, fontWeight) {
    return fontSizePx >= 24 || (fontSizePx >= 18.66 && fontWeight >= 700);
  }

  function contrastRatio(foreground, background) {
    // WCAG contrast ratio formula.
    const fg = relativeLuminance(foreground);
    const bg = relativeLuminance(background);
    const lighter = Math.max(fg, bg);
    const darker = Math.min(fg, bg);
    return (lighter + 0.05) / (darker + 0.05);
  }

  function relativeLuminance(color) {
    const r = channelToLinear(color.r / 255);
    const g = channelToLinear(color.g / 255);
    const b = channelToLinear(color.b / 255);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function channelToLinear(value) {
    return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
  }

  function shortSelector(element) {
    if (!element) {
      return "unknown";
    }

    const id = element.id ? `#${element.id}` : "";
    const classes = Array.from(element.classList).slice(0, 2).join(".");
    const cls = classes ? `.${classes}` : "";
    return `${element.tagName.toLowerCase()}${id}${cls}`;
  }

  function trimSample(text) {
    if (!text) {
      return "";
    }
    const normalized = text.replace(/\s+/g, " ").trim();
    if (normalized.length <= 120) {
      return normalized;
    }

    const cutIndex = normalized.lastIndexOf(" ", 117);
    const endIndex = cutIndex > 60 ? cutIndex : 117;
    return `${normalized.slice(0, endIndex).trimEnd()}...`;
  }

  function getSampleElement(element) {
    let current = element;

    while (current && current !== document.body && current !== document.documentElement) {
      if (isGoodSampleContainer(current)) {
        return current;
      }
      current = current.parentElement;
    }

    return element;
  }

  function isGoodSampleContainer(element) {
    const tag = element.tagName.toLowerCase();
    if (["p", "li", "blockquote", "dd", "dt", "figcaption", "caption", "td", "th", "button", "a", "label", "summary", "h1", "h2", "h3", "h4", "h5", "h6"].includes(tag)) {
      return true;
    }

    const style = getComputedStyle(element);
    return style.display === "block" || style.display === "flow-root" || style.display === "list-item" || style.display === "grid" || style.display === "flex";
  }

  function getVisibleText(element) {
    if (!element) {
      return "";
    }

    const text = "innerText" in element ? element.innerText : element.textContent || "";
    return text.replace(/\s+/g, " ").trim();
  }

  function groupFindings(items) {
    // Merge similar findings while preserving representative examples and worst-case details.
    const groups = new Map();

    for (const item of items) {
      const key = getGroupingKey(item);
      const existing = groups.get(key);

      if (!existing) {
        groups.set(key, {
          ...item,
          sample: trimSample(item.sample),
          count: 1,
          selectors: [item.selector],
          examples: item.sample ? [trimSample(item.sample)] : [],
          instances: [makeInstance(item)]
        });
        continue;
      }

      existing.count += 1;
      existing.selectors.push(item.selector);
      if (existing.examples.length < 3 && item.sample) {
        existing.examples.push(trimSample(item.sample));
      }
      existing.instances.push(makeInstance(item));

      if (severityRank(item.severity) > severityRank(existing.severity)) {
        existing.severity = item.severity;
      }

      if (item.details && existing.details) {
        existing.details = mergeDetails(existing.details, item.details);
      }
    }

    return Array.from(groups.values()).map((group) => ({
      ...group,
      selector: summarizeSelectors(group.selectors),
      sample: group.examples[0] || group.sample,
      details: {
        ...group.details,
        count: group.count,
        selectors: group.selectors.slice(0, 5),
        examples: group.examples
      },
      instances: group.instances.slice(0, 60)
    }));
  }

  function getGroupingKey(item) {
    // Category-aware keys prevent unrelated issues from collapsing together.
    const selector = normalizeSelectorKey(item.selector);
    const details = item.details || {};
    const category = item.category || item.type;

    if (item.type === "low-contrast-text" || item.type === "low-contrast-complex-background") {
      return [category, selector, details.requiredRatio ?? "", details.fontSizePx ? Math.round(details.fontSizePx / 2) * 2 : ""].join("|");
    }

    if (item.type === "very-small-text" || item.type === "small-text") {
      return [category, selector, details.fontSizePx ? Math.round(details.fontSizePx / 2) * 2 : ""].join("|");
    }

    if (item.type === "tight-line-height") {
      const sizeBucket = details.fontSizePx ? Math.round(details.fontSizePx / 2) * 2 : "";
      const lineHeightBucket = details.lineHeightPx ? Math.round(details.lineHeightPx / 2) * 2 : "";
      return [category, selector, sizeBucket, lineHeightBucket].join("|");
    }

    return [category, selector].join("|");
  }

  function normalizeSelectorKey(selector) {
    // Normalize noisy id/class tokens to improve grouping stability across pages.
    if (!selector || selector === "unknown") {
      return "unknown";
    }

    return selector
      .replace(/#[^.\s]+/g, "#id")
      .replace(/\.[^.\s]+/g, ".class")
      .replace(/\s+/g, " ")
      .trim();
  }

  function makeInstance(item) {
    return {
      selector: item.selector,
      targetId: item.targetId,
      targetSelector: item.targetSelector,
      sample: trimSample(item.sample),
      severity: item.severity,
      details: item.details
    };
  }

  function registerAuditTarget(element) {
    if (!element) {
      return "";
    }

    auditTargetCounter += 1;
    const id = `lv-target-${auditTargetCounter}`;
    auditTargets.set(id, element);
    return id;
  }

  function buildTargetSelector(element) {
    if (!element || !element.tagName) {
      return "";
    }

    if (element.id) {
      return `#${cssEscapeValue(element.id)}`;
    }

    const parts = [];
    let current = element;

    while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body) {
      const tag = current.tagName.toLowerCase();
      let index = 1;
      let sibling = current;

      while ((sibling = sibling.previousElementSibling)) {
        if (sibling.tagName.toLowerCase() === tag) {
          index += 1;
        }
      }

      parts.unshift(`${tag}:nth-of-type(${index})`);

      if (current.id) {
        parts.unshift(`#${cssEscapeValue(current.id)}`);
        break;
      }

      current = current.parentElement;
    }

    return parts.join(" > ");
  }

  function cssEscapeValue(value) {
    if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
      return CSS.escape(value);
    }

    return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }

  function findHighlightTarget(targetId, targetSelector, sample) {
    const byId = typeof targetId === "string" ? auditTargets.get(targetId) : null;
    if (byId && byId.isConnected) {
      return byId;
    }

    const selector = typeof targetSelector === "string" ? targetSelector.trim() : "";
    const textSample = normalizeSample(sample);

    if (!selector) {
      return null;
    }

    try {
      const matches = Array.from(document.querySelectorAll(selector));
      if (matches.length === 0) {
        return null;
      }

      if (!textSample) {
        return matches[0];
      }

      const byText = matches.find((el) => normalizeSample(getVisibleText(el)).includes(textSample));
      return byText || matches[0];
    } catch (_error) {
      return null;
    }
  }

  function normalizeSample(text) {
    return String(text || "")
      .replace(/\.\.\./g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function highlightElement(element) {
    if (typeof activeHighlightCleanup === "function") {
      activeHighlightCleanup();
      activeHighlightCleanup = null;
    }

    const previousOutline = element.style.outline;
    const previousOutlineOffset = element.style.outlineOffset;
    const previousBoxShadow = element.style.boxShadow;
    const previousTransition = element.style.transition;

    element.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });

    element.style.transition = `${previousTransition ? `${previousTransition}, ` : ""}outline-color 120ms ease-out, box-shadow 120ms ease-out`;
    element.style.outline = "3px solid #0f766e";
    element.style.outlineOffset = "3px";
    element.style.boxShadow = "0 0 0 4px rgba(15, 118, 110, 0.25)";

    const timeoutId = window.setTimeout(() => {
      cleanup();
      activeHighlightCleanup = null;
    }, 2200);

    function cleanup() {
      window.clearTimeout(timeoutId);
      element.style.outline = previousOutline;
      element.style.outlineOffset = previousOutlineOffset;
      element.style.boxShadow = previousBoxShadow;
      element.style.transition = previousTransition;
    }

    activeHighlightCleanup = cleanup;
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

  function summarizeSelectors(selectors) {
    const unique = Array.from(new Set(selectors));
    if (unique.length <= 3) {
      return unique.join(", ");
    }

    return `${unique.slice(0, 3).join(", ")} (+${unique.length - 3} more)`;
  }

  function mergeDetails(existingDetails, newDetails) {
    // Keep the strictest metrics when combining grouped detail payloads.
    const merged = {
      ...existingDetails,
      ...newDetails
    };

    const existingContrast = typeof existingDetails.contrastRatio === "number" ? existingDetails.contrastRatio : null;
    const newContrast = typeof newDetails.contrastRatio === "number" ? newDetails.contrastRatio : null;
    if (existingContrast !== null && newContrast !== null && newContrast < existingContrast) {
      merged.textColor = newDetails.textColor;
      merged.backgroundColor = newDetails.backgroundColor;
      merged.suggestedTextColor = newDetails.suggestedTextColor;
    }

    if (typeof existingDetails.requiredRatio === "number" || typeof newDetails.requiredRatio === "number") {
      merged.requiredRatio = Math.max(existingDetails.requiredRatio ?? 0, newDetails.requiredRatio ?? 0);
    }

    if (typeof existingDetails.contrastRatio === "number" || typeof newDetails.contrastRatio === "number") {
      merged.contrastRatio = Math.min(existingDetails.contrastRatio ?? Number.POSITIVE_INFINITY, newDetails.contrastRatio ?? Number.POSITIVE_INFINITY);
    }

    if (typeof existingDetails.fontSizePx === "number" || typeof newDetails.fontSizePx === "number") {
      merged.fontSizePx = Math.min(existingDetails.fontSizePx ?? Number.POSITIVE_INFINITY, newDetails.fontSizePx ?? Number.POSITIVE_INFINITY);
    }

    if (typeof existingDetails.lineHeightPx === "number" || typeof newDetails.lineHeightPx === "number") {
      merged.lineHeightPx = Math.min(existingDetails.lineHeightPx ?? Number.POSITIVE_INFINITY, newDetails.lineHeightPx ?? Number.POSITIVE_INFINITY);
    }

    return merged;
  }

  function suggestReadableTextColor(background, threshold) {
    // Pick black or white based on best achievable contrast against the background.
    const black = { r: 0, g: 0, b: 0, a: 1 };
    const white = { r: 255, g: 255, b: 255, a: 1 };
    const blackRatio = contrastRatio(black, background);
    const whiteRatio = contrastRatio(white, background);

    if (blackRatio >= threshold && blackRatio >= whiteRatio) {
      return colorToCss(black);
    }
    if (whiteRatio >= threshold && whiteRatio >= blackRatio) {
      return colorToCss(white);
    }

    return blackRatio >= whiteRatio ? colorToCss(black) : colorToCss(white);
  }

  function colorToCss(color) {
    const r = Math.round(color.r);
    const g = Math.round(color.g);
    const b = Math.round(color.b);
    return `rgb(${r}, ${g}, ${b})`;
  }

  function getWcagMapping(type, context = {}) {
    if (type === "low-contrast-text") {
      return {
        criteria: ["WCAG 2.2 SC 1.4.3 Contrast (Minimum)"],
        rationale: context.largeText
          ? "Large text must meet at least 3:1 contrast so users with reduced contrast sensitivity can still distinguish glyph edges."
          : "Body-sized text must meet at least 4.5:1 contrast so users with low vision can read without excessive zoom or strain."
      };
    }

    if (type === "low-contrast-complex-background") {
      return {
        criteria: ["WCAG 2.2 SC 1.4.3 Contrast (Minimum)"],
        rationale:
          "Image and gradient backgrounds create localized contrast changes; add consistent overlays or text containers so contrast remains sufficient across all regions."
      };
    }

    if (type === "very-small-text" || type === "small-text") {
      return {
        criteria: ["WCAG 2.2 SC 1.4.4 Resize Text", "WCAG 2.2 SC 1.4.10 Reflow"],
        rationale:
          "Small base text increases magnification dependence and can break usability when users zoom to 200%; readable base sizing improves both resize and reflow outcomes."
      };
    }

    if (type === "tight-line-height") {
      return {
        criteria: ["WCAG 2.2 SC 1.4.12 Text Spacing"],
        rationale:
          "Dense line spacing makes line tracking harder for low-vision readers; supporting looser spacing reduces skipped lines and reading fatigue."
      };
    }

    return {
      criteria: [],
      rationale: "Mapped rationale unavailable."
    };
  }
})();
