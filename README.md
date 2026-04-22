# Low Vision Checker

A Chrome extension that detects common readability barriers for people with low vision and offers suggestions for improvement.

## Overview

Low Vision Checker automatically scans the visible text on a webpage and evaluates readability-related issues, with a focus on contrast sensitivity and text legibility. It identifies problems that may make content difficult to read for people with low vision and provides actionable recommendations for developers.

## Features

- **One-click auditing**: Scan the current tab for low-vision readability issues
- **Detailed findings**: Get grouped results organized by issue category
- **Fix-first mode**: Toggle "Fix first mode" to prioritize issues by impact
- **Actionable recommendations**: Each finding includes specific guidance on how to fix the issue
- **WCAG mappings**: Understand how findings relate to Web Content Accessibility Guidelines

## How to Use

1. Open any webpage in Chrome
2. Click the Low Vision Checker extension icon
3. Click the **Run** button to scan the current tab
4. Review the findings grouped by category
5. Click on any finding to expand details and see recommendations
6. Use "Fix first mode" to sort findings by highest impact first

## Understanding the Results

### Severity Indicators

Each finding displays a severity bubble to help you prioritize fixes:

- **Medium** (orange): The contrast ratio is slightly below the recommended minimum. While readable for many users, it may be challenging for people with reduced contrast sensitivity. These are good candidates for quick wins in your accessibility improvement plan.

- **High** (red): The contrast ratio is significantly below the recommended minimum. Text is likely difficult to read for people with low vision. These issues should be prioritized for immediate fixes.

The severity is determined by how far the measured contrast ratio falls below the required threshold. Larger gaps receive a "high" severity rating.

### Recommended Contrast Ratios

- **Normal text**: 4.5:1 (WCAG AA standard)
- **Large text** (18pt or 14pt bold and larger): 3:1 (WCAG AA standard)

## Limitations

Automated checks have inherent limitations. This tool **cannot**:

- Understand design intent or reading order quality
- Provide precise measurements for text over images, gradients, overlays, or animations (results are approximate)
- Cover all disability needs or all WCAG success criteria
- Replace manual testing with real users or assistive technology

### What You Still Need to Do

- Test with zoom and high-contrast modes enabled
- Use assistive technologies like screen readers and screen magnification
- Conduct manual testing with real users who have low vision
- Review color contrast for animated or moving elements
- Verify readability across different devices and lighting conditions

## Technical Details

### How It Works

1. The extension collects samples of visible text blocks from the page
2. For each text sample, it calculates:
   - Color contrast ratio (using WCAG color luminance formula)
   - Font size and weight
   - Background complexity (solid color vs. image/gradient)
3. It compares measured ratios against WCAG AA standards
4. Issues are grouped by category and severity for easy review

### Complex Backgrounds

When text appears over images or gradients, the reported contrast ratio is **approximate**. This is because:
- Colors vary across the background
- Multiple overlays may be present
- Transparency and animations can affect perceived contrast

For these cases, the recommendation is to add a solid, semi-transparent overlay behind the text to ensure consistent, measurable contrast.

## Contributing & Feedback

This extension focuses specifically on low-vision readability signals. If you have suggestions for improvements or encounter false positives/negatives, please report them.

## License

This project is created for CS 1952B at Brown University.
