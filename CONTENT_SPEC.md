# Documentation Content Spec for Flux SuiteApps

> Give this file to an LLM along with your SuiteApp source code to generate documentation.

## Overview

You are generating documentation for Flux SuiteApps to be displayed on `flux.com/docs`. The website expects **MDX files** (Markdown with optional JSX) in a specific folder structure with frontmatter metadata.

---

## Folder Structure

```
/docs/
├── index.mdx                    # Product overview (required)
├── installation.mdx             # Installation guide
├── configuration.mdx            # Initial setup/config
├── troubleshooting.mdx          # Common issues
└── modules/                     # For Gantry
    ├── index.mdx                # Modules overview
    ├── ai-advisor.mdx
    ├── liquidity.mdx
    ├── profitability.mdx
    ├── true-cost.mdx
    ├── billable-iq.mdx
    ├── sentinel.mdx
    ├── procurement.mdx
    ├── spend-velocity.mdx
    └── revenue-intelligence.mdx

# OR for Capture:
└── features/
    ├── index.mdx                # Features overview
    ├── smart-extract.mdx
    ├── learning-engine.mdx
    ├── fraud-shield.mdx
    ├── side-by-side-review.mdx
    └── email-to-invoice.mdx
```

---

## File Format

Every `.mdx` file MUST start with YAML frontmatter:

```mdx
---
title: "AI Advisor"
description: "Natural language financial insights powered by AI"
order: 1
icon: "sparkles"
---

Your markdown content here...
```

### Frontmatter Schema

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | string | ✅ | Page title (used in sidebar and page header) |
| `description` | string | ✅ | Brief description (used in meta tags and page subtitle) |
| `order` | number | ✅ | Sort order in sidebar (lower = higher position) |
| `icon` | string | ❌ | Lucide icon name (e.g., "sparkles", "shield", "zap") |
| `badge` | string | ❌ | Optional badge text (e.g., "New", "Beta", "Pro") |

---

## Content Guidelines

### Heading Structure
- Start content with `##` (h2) - the `#` (h1) is auto-generated from frontmatter title
- Use `###` for subsections, `####` for sub-subsections
- Keep hierarchy logical: h2 → h3 → h4

### Code Blocks
Use triple backticks with language identifier:

````mdx
```javascript
// SuiteScript example
define(['N/record'], function(record) {
    // code here
});
```
````

Supported languages: `javascript`, `typescript`, `json`, `xml`, `bash`, `sql`

### Callouts/Admonitions
Use blockquotes with emoji prefixes:

```mdx
> ℹ️ **Info**: This is an informational note.

> ⚠️ **Warning**: This requires admin permissions.

> ✅ **Tip**: Best practice recommendation.

> 🚨 **Danger**: This action cannot be undone.
```

### Tables
Standard markdown tables:

```mdx
| Column 1 | Column 2 | Column 3 |
|----------|----------|----------|
| Value    | Value    | Value    |
```

### Images
Place images in `/public/docs/[product]/` and reference:

```mdx
![Dashboard Screenshot](/docs/gantry/dashboard-overview.png)
```

### Internal Links
Link to other doc pages using relative paths:

```mdx
See the [Installation Guide](/docs/gantry/installation) for setup instructions.
Learn about [AI Advisor](/docs/gantry/modules/ai-advisor).
```

---

## Content Structure Templates

### Product Index Page (`index.mdx`)

```mdx
---
title: "Flux Gantry"
description: "Financial Intelligence Platform for NetSuite"
order: 0
icon: "layout-dashboard"
---

Brief 2-3 sentence overview of what the product does.

## Key Features

- **Feature 1**: Brief description
- **Feature 2**: Brief description
- **Feature 3**: Brief description

## Getting Started

1. [Install Gantry](/docs/gantry/installation) from the SuiteApp marketplace
2. [Configure your settings](/docs/gantry/configuration)
3. [Explore the modules](/docs/gantry/modules)

## Requirements

- NetSuite account with Administrator role
- SuiteApp installation permissions
- [Any other requirements]
```

### Installation Page

```mdx
---
title: "Installation"
description: "How to install [Product] in your NetSuite account"
order: 1
icon: "download"
---

## Prerequisites

- List prerequisites here

## Installation Steps

### Step 1: Access the SuiteApp Marketplace

1. Log into NetSuite as Administrator
2. Navigate to **Customization → SuiteCloud Development → SuiteApp Marketplace**
3. Search for "[Product Name]"

### Step 2: Install the Bundle

1. Click **Install**
2. Review permissions
3. Confirm installation

### Step 3: Verify Installation

Describe how to verify it worked.

## Post-Installation

What to do next after installation.

## Troubleshooting

Common installation issues and solutions.
```

### Module/Feature Page

```mdx
---
title: "AI Advisor"
description: "Natural language financial insights powered by AI"
order: 1
icon: "sparkles"
badge: "Pro"
---

Brief 2-3 sentence description of what this module does and its value.

## Overview

Detailed explanation of the module's purpose and capabilities.

## How It Works

Explain the technical/functional flow.

## Key Capabilities

### Capability 1
Description with details.

### Capability 2
Description with details.

## Configuration

How to set up and configure this module.

```javascript
// Example code if applicable
```

## Usage Examples

### Example 1: [Use Case]
Step-by-step walkthrough.

### Example 2: [Use Case]
Step-by-step walkthrough.

## Best Practices

- Recommendation 1
- Recommendation 2

## FAQ

### Question 1?
Answer.

### Question 2?
Answer.
```

---

## Filename Conventions

- Use **kebab-case** for all filenames: `ai-advisor.mdx`, `smart-extract.mdx`
- Match the slug you want in the URL: `ai-advisor.mdx` → `/docs/gantry/modules/ai-advisor`
- Always include `index.mdx` in folders for the default page

---

## Icon Reference

Use these Lucide icon names in frontmatter:

| Use Case | Icon |
|----------|------|
| Overview/Dashboard | `layout-dashboard` |
| Installation | `download` |
| Configuration | `settings` |
| AI/Intelligence | `sparkles`, `brain` |
| Security/Fraud | `shield`, `shield-alert` |
| Money/Finance | `dollar-sign`, `trending-up` |
| Documents/Invoices | `file-text`, `files` |
| Email | `mail` |
| Search/Extract | `search`, `scan` |
| Learning/ML | `graduation-cap` |
| Troubleshooting | `wrench`, `life-buoy` |
| Speed/Velocity | `zap`, `gauge` |
| Procurement | `shopping-cart` |
| Time | `clock` |
| Health/Status | `activity`, `heart-pulse` |

---

## What NOT to Include

- No React/JSX components (keep it pure markdown)
- No import statements
- No custom HTML (except basic `<br/>` if needed)
- No external scripts or embeds
- No hardcoded absolute URLs to the website (use relative `/docs/...` paths)

---

## Validation Checklist

Before submitting generated docs, verify:

- [ ] Every `.mdx` file has valid frontmatter with title, description, order
- [ ] No duplicate `order` values within the same folder
- [ ] All internal links use correct relative paths
- [ ] Code blocks have language identifiers
- [ ] Heading hierarchy starts at `##`
- [ ] Filenames are kebab-case
- [ ] Each folder has an `index.mdx`

---

## Example Prompt for LLM

```
I have a NetSuite SuiteApp called [Gantry/Capture]. Using the attached source code and the CONTENT_SPEC.md file, generate complete documentation in MDX format.

Create the following files:
1. index.mdx - Product overview
2. installation.mdx - Installation guide
3. configuration.mdx - Configuration guide
4. modules/index.mdx - Modules overview (or features/index.mdx for Capture)
5. Individual module/feature pages

For each module/feature, analyze the source code to:
- Explain what it does
- Document configuration options
- Provide usage examples
- List any prerequisites or dependencies

Output each file with its full path and contents.
```
