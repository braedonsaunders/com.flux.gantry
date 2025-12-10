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

## GitHub Actions (Auto-Deploy on Push)

Push to `main` → automatically deploys to NetSuite → refresh your browser to see changes.

### Step 1: Enable Features in NetSuite

1. Go to **Setup > Company > Enable Features > SuiteCloud**
2. Check these boxes:
   - **Client SuiteScript**
   - **Server SuiteScript**
   - **Token-Based Authentication**
   - **SuiteCloud Development Framework**

### Step 2: Create an Integration Record

1. Go to **Setup > Integration > Manage Integrations > New**
2. Fill in:
   - **Name**: `GitHub Deploy` (or any name)
   - **State**: Enabled
   - Check **Token-Based Authentication**
   - Uncheck **TBA: Authorization Flow** (not needed)
   - Uncheck **Authorization Code Grant** (not needed)
3. Click **Save**
4. **COPY these values immediately** (shown only once):
   - **Consumer Key** → this is your `NS_AUTH_ID`
   - Consumer Secret (not needed for this setup)

### Step 3: Create Access Tokens

1. Go to **Setup > Users/Roles > Access Tokens > New**
2. Select:
   - **Application Name**: The integration you just created
   - **User**: Your user (must have Administrator or similar role)
   - **Role**: Administrator
3. Click **Save**
4. **COPY these values immediately** (shown only once):
   - **Token ID** → this is your `NS_TOKEN_ID`
   - **Token Secret** → this is your `NS_TOKEN_SECRET`

### Step 4: Add Secrets to GitHub

1. Go to your GitHub repo → **Settings** → **Secrets and variables** → **Actions**
2. Click **New repository secret** and add these 4 secrets:

| Secret Name | Value |
|-------------|-------|
| `NS_ACCOUNT_ID` | Your NetSuite account ID (e.g., `1234567` or `1234567_SB1` for sandbox) |
| `NS_AUTH_ID` | Consumer Key from Step 2 |
| `NS_TOKEN_ID` | Token ID from Step 3 |
| `NS_TOKEN_SECRET` | Token Secret from Step 3 |

### Step 5: Push and Deploy!

```bash
git push origin main
```

Go to **Actions** tab in GitHub to watch the deployment. Once complete, refresh NetSuite.

### Finding Your Account ID

- **Production**: Setup > Company > Company Information → **Account ID**
- **Sandbox**: Same as production but with `_SB1`, `_SB2`, etc. suffix

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
