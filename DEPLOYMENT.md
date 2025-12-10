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

> **Note**: As of NetSuite 2024.2, Token-Based Authentication (TBA) is no longer supported for CI/CD.
> OAuth 2.0 with certificate authentication is now required.

### Step 1: Enable Features in NetSuite

1. Go to **Setup > Company > Enable Features > SuiteCloud**
2. Check these boxes:
   - **Client SuiteScript**
   - **Server SuiteScript**
   - **SuiteCloud Development Framework**
   - **OAuth 2.0**

### Step 2: Generate Key Pair

On your local machine, generate a public/private key pair:

```bash
# Generate private key
openssl genrsa -out private.pem 4096

# Generate public key from private key
openssl rsa -in private.pem -pubout -out public.pem
```

Keep `private.pem` secure - you'll need it for GitHub secrets.

### Step 3: Upload Public Key to NetSuite

1. Go to **Setup > Integration > OAuth 2.0 Client Credentials (M2M) Setup**
2. Click **Create New**
3. Fill in:
   - **Application**: SuiteCloud Development Integration
   - **Entity**: Your user
   - **Role**: Administrator (or role with SuiteScript permissions)
4. Upload the `public.pem` file you generated
5. Click **Save**
6. **COPY the Certificate ID** that appears (you'll need this)

### Step 4: Add Secrets to GitHub

1. Go to your GitHub repo → **Settings** → **Secrets and variables** → **Actions**
2. Add these 3 secrets:

| Secret Name | Value |
|-------------|-------|
| `NS_ACCOUNT_ID` | Your NetSuite account ID (e.g., `1234567` or `1234567_SB1` for sandbox) |
| `NS_CERTIFICATE_ID` | Certificate ID from Step 3 |
| `NS_PRIVATE_KEY` | Base64-encoded private key (see below) |

**To encode the private key:**

```bash
# macOS/Linux
cat private.pem | base64 | tr -d '\n'

# Or on macOS
base64 -i private.pem | tr -d '\n'
```

Copy the entire output (one long string) and paste as the `NS_PRIVATE_KEY` secret.

### Step 5: Push and Deploy!

```bash
git push origin main
```

Go to **Actions** tab in GitHub to watch the deployment. Once complete, refresh NetSuite.

### Finding Your Account ID

- **Production**: Setup > Company > Company Information → **Account ID**
- **Sandbox**: Same as production but with `_SB1`, `_SB2`, etc. suffix

### Troubleshooting OAuth 2.0

- **Certificate ID not showing**: Make sure you selected "SuiteCloud Development Integration" as the Application
- **Permission denied**: Ensure the Entity/Role combination has full SuiteScript and File Cabinet permissions
- **Key format error**: Make sure you're base64 encoding the entire private.pem file including the BEGIN/END lines

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
