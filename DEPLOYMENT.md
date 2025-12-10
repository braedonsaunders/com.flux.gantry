# NetSuite Deployment Guide

This project uses SuiteCloud CLI for deploying to NetSuite. Changes sync to the File Cabinet without changing your existing script/deployment IDs.

## Quick Start (Local Development)

### 1. Install SuiteCloud CLI

```bash
npm install -g @oracle/suitecloud-cli
```

### 2. Setup Authentication

Run the setup wizard to configure your NetSuite account:

```bash
suitecloud account:setup
```

You'll need:
- **Account ID**: Your NetSuite account ID (e.g., `1234567` or `1234567_SB1` for sandbox)
- **Token-Based Authentication**: Create an integration and tokens in NetSuite

### 3. Deploy Changes

**Option A: Smart Sync (Recommended for development)**

Only uploads files that have changed - much faster for iterative development:

```bash
node scripts/sync.js          # Sync only changed files
node scripts/sync.js --watch  # Watch mode: auto-sync on file save
node scripts/sync.js --all    # Force sync all files
```

**Option B: Full Deploy**

Deploy all files to NetSuite:

```bash
suitecloud project:deploy
```

**Option C: Single File**

Upload a specific file:

```bash
suitecloud file:upload --paths "src/FileCabinet/SuiteApps/com.gantry.finance/lib/Lib_Core.js"
```

## GitHub Actions (Auto-Deploy)

The workflow in `.github/workflows/deploy-netsuite.yml` automatically deploys on push to `main` or `deploy` branches.

### Setup GitHub Secrets

Add these secrets to your repository (Settings > Secrets and variables > Actions):

1. **`NETSUITE_ACCOUNT_ID`**: Your NetSuite account ID
2. **`NETSUITE_AUTH`**: JSON credentials file content:

```json
{
  "accountId": "YOUR_ACCOUNT_ID",
  "tokenId": "YOUR_TOKEN_ID",
  "tokenSecret": "YOUR_TOKEN_SECRET",
  "authenticationId": "YOUR_AUTH_ID"
}
```

### Creating NetSuite Tokens

1. Go to **Setup > Company > Enable Features > SuiteCloud**
2. Enable **Token-Based Authentication**
3. Create an **Integration** (Setup > Integration > Manage Integrations > New)
   - Check "Token-Based Authentication"
   - Save and note the Consumer Key/Secret
4. Create **Access Tokens** (Setup > Users/Roles > Access Tokens > New)
   - Select your integration and user
   - Save and note the Token ID/Secret

## Project Structure

```
com.gantry.finance/
├── src/
│   ├── FileCabinet/
│   │   └── SuiteApps/
│   │       └── com.gantry.finance/
│   │           ├── App/           # HTML, CSS assets
│   │           ├── client/        # Client-side JS
│   │           ├── lib/           # Server-side libraries
│   │           └── suitelet/      # Suitelet & RESTlet scripts
│   ├── Objects/
│   │   ├── customscript_gantry_suitelet.xml
│   │   └── customscript_gantry_router.xml
│   ├── deploy.xml
│   └── manifest.xml
├── scripts/
│   └── sync.js               # Smart sync script (changed files only)
├── suitecloud.config.js
└── .github/workflows/deploy-netsuite.yml
```

## Preserved Deployment IDs

Your existing URLs remain unchanged:

| Script | Script ID | Deployment ID |
|--------|-----------|---------------|
| Suitelet | `customscript_gantry_suitelet` | `customdeploy_gantry_suitelet` |
| RESTlet | `customscript_gantry_router` | `customdeploy_gantry_router` |

## Common Commands

```bash
# Validate project structure
suitecloud project:validate

# Deploy everything
suitecloud project:deploy

# Upload single file
suitecloud file:upload --paths "src/FileCabinet/SuiteApps/com.gantry.finance/lib/Lib_Core.js"

# List objects in account
suitecloud object:list --type suitelet

# Import existing objects from NetSuite
suitecloud object:import --type suitelet --destinationfolder "src/Objects"
```

## Troubleshooting

### "Script file not found" error
Ensure file paths in XML match the actual file locations in `src/FileCabinet/`.

### Authentication issues
Re-run `suitecloud account:setup` or check that your tokens haven't expired.

### Deployment conflicts
If scripts already exist with different configurations, use `suitecloud object:import` to sync the current state first, then modify and redeploy.
