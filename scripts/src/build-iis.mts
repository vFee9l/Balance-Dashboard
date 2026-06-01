import { execSync } from "child_process";
import { cp, mkdir, rm, writeFile, readFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const deployDir = path.resolve(root, "iis-deploy");

function run(cmd: string, cwd: string = root) {
  console.log(`\n▶ ${cmd}`);
  execSync(cmd, { cwd, stdio: "inherit" });
}

async function main() {
  console.log("=== BalanceAlert IIS Deployment Builder ===\n");

  // 1. Clean previous deploy
  console.log("🧹 Cleaning previous deploy folder...");
  await rm(deployDir, { recursive: true, force: true });
  await mkdir(deployDir, { recursive: true });
  await mkdir(path.join(deployDir, "web"), { recursive: true });
  await mkdir(path.join(deployDir, "api", "dist"), { recursive: true });

  // 2. Build frontend
  console.log("\n📦 Building frontend (React + Vite)...");
  run(
    "pnpm --filter @workspace/balance-alerts run build",
    root,
  );

  // 3. Build API server
  console.log("\n🔧 Building API server (Node.js + esbuild)...");
  run("pnpm --filter @workspace/api-server run build", root);

  // 4. Copy frontend static files
  console.log("\n📁 Copying frontend files...");
  const frontendDist = path.join(root, "artifacts/balance-alerts/dist/public");
  if (!existsSync(frontendDist)) {
    throw new Error(`Frontend dist not found at ${frontendDist}. Build may have failed.`);
  }
  await cp(frontendDist, path.join(deployDir, "web"), { recursive: true });

  // 5. Copy API dist
  console.log("📁 Copying API server files...");
  const apiDist = path.join(root, "artifacts/api-server/dist");
  if (!existsSync(apiDist)) {
    throw new Error(`API dist not found at ${apiDist}. Build may have failed.`);
  }
  await cp(apiDist, path.join(deployDir, "api/dist"), { recursive: true });

  // 6. Write web.config for IIS
  console.log("\n⚙️  Writing IIS web.config...");
  await writeFile(
    path.join(deployDir, "web/web.config"),
    webConfig(),
    "utf8",
  );

  // 7. Write API start scripts
  console.log("⚙️  Writing API start scripts...");
  await writeFile(path.join(deployDir, "api/start-api.bat"), startApiBat(), "utf8");
  await writeFile(path.join(deployDir, "api/install-service.bat"), installServiceBat(), "utf8");
  await writeFile(path.join(deployDir, "api/.env.example"), envExample(), "utf8");

  // 8. Write deployment guide
  await writeFile(path.join(deployDir, "DEPLOY.md"), deployGuide(), "utf8");

  console.log(`\n✅ IIS deployment package ready at: ${deployDir}`);
  console.log("   📖 Read iis-deploy/DEPLOY.md for step-by-step instructions.\n");
}

function webConfig() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!--
  IIS web.config for BalanceAlert
  Requires: URL Rewrite module + Application Request Routing (ARR)
  Place this file alongside the frontend static files (web/ folder)
-->
<configuration>
  <system.webServer>

    <!-- Enable reverse proxy for /api to Node.js backend -->
    <proxy enabled="true" />

    <rewrite>
      <rules>

        <!-- Rule 1: proxy all /api/* requests to the Node.js backend -->
        <rule name="API Reverse Proxy" stopProcessing="true">
          <match url="^api/(.*)" />
          <action type="Rewrite" url="http://localhost:8080/api/{R:1}" />
          <serverVariables>
            <set name="HTTP_X_FORWARDED_HOST" value="{HTTP_HOST}" />
            <set name="HTTP_X_FORWARDED_PROTO" value="https" />
          </serverVariables>
        </rule>

        <!-- Rule 2: SPA fallback — serve index.html for all non-file routes -->
        <rule name="SPA Fallback" stopProcessing="true">
          <match url=".*" />
          <conditions logicalGrouping="MatchAll">
            <add input="{REQUEST_FILENAME}" matchType="IsFile" negate="true" />
            <add input="{REQUEST_FILENAME}" matchType="IsDirectory" negate="true" />
          </conditions>
          <action type="Rewrite" url="/index.html" />
        </rule>

      </rules>
    </rewrite>

    <!-- Static content MIME types -->
    <staticContent>
      <remove fileExtension=".json" />
      <mimeMap fileExtension=".json" mimeType="application/json" />
      <remove fileExtension=".woff" />
      <mimeMap fileExtension=".woff" mimeType="application/font-woff" />
      <remove fileExtension=".woff2" />
      <mimeMap fileExtension=".woff2" mimeType="font/woff2" />
      <remove fileExtension=".svg" />
      <mimeMap fileExtension=".svg" mimeType="image/svg+xml" />
      <remove fileExtension=".webp" />
      <mimeMap fileExtension=".webp" mimeType="image/webp" />
    </staticContent>

    <!-- Pass error responses from Node.js through unmodified -->
    <httpErrors existingResponse="PassThrough" />

  </system.webServer>
</configuration>
`;
}

function startApiBat() {
  return `@echo off
:: ======================================================
:: BalanceAlert API Server — Start Script
:: Copy this file to api/ and edit the variables below
:: ======================================================

SET PORT=8080
SET NODE_ENV=production

:: --- Required: PostgreSQL connection string ---
SET DATABASE_URL=postgresql://user:password@localhost:5432/balance_alert

:: --- Required: Random secret for session cookies (change this!) ---
SET SESSION_SECRET=change-me-to-a-long-random-secret

:: --- Optional: If your IIS site is on HTTPS, set this ---
:: SET COOKIE_SECURE=true

echo Starting BalanceAlert API on port %PORT%...
node dist\\index.mjs
`;
}

function installServiceBat() {
  return `@echo off
:: ======================================================
:: BalanceAlert API — Install as Windows Service (NSSM)
::
:: Prerequisites:
::   1. Download NSSM from https://nssm.cc/download
::   2. Copy nssm.exe to C:\\Windows\\System32 (or update path below)
::   3. Run this script as Administrator
:: ======================================================

SET SERVICE_NAME=BalanceAlertAPI
SET APP_DIR=%~dp0
SET NODE_EXE=node
SET PORT=8080
SET NODE_ENV=production

:: --- Edit these values ---
SET DATABASE_URL=postgresql://user:password@localhost:5432/balance_alert
SET SESSION_SECRET=change-me-to-a-long-random-secret

echo Installing Windows service: %SERVICE_NAME%

nssm install %SERVICE_NAME% %NODE_EXE% "%APP_DIR%dist\\index.mjs"
nssm set %SERVICE_NAME% AppDirectory "%APP_DIR%"
nssm set %SERVICE_NAME% AppEnvironmentExtra PORT=%PORT%
nssm set %SERVICE_NAME% AppEnvironmentExtra NODE_ENV=%NODE_ENV%
nssm set %SERVICE_NAME% AppEnvironmentExtra DATABASE_URL=%DATABASE_URL%
nssm set %SERVICE_NAME% AppEnvironmentExtra SESSION_SECRET=%SESSION_SECRET%
nssm set %SERVICE_NAME% Start SERVICE_AUTO_START
nssm set %SERVICE_NAME% ObjectName LocalSystem
nssm set %SERVICE_NAME% AppStdout "%APP_DIR%logs\\api-stdout.log"
nssm set %SERVICE_NAME% AppStderr "%APP_DIR%logs\\api-stderr.log"
nssm set %SERVICE_NAME% AppRotateFiles 1
nssm set %SERVICE_NAME% AppRotateOnline 1
nssm set %SERVICE_NAME% AppRotateSeconds 86400

mkdir "%APP_DIR%logs" 2>nul

net start %SERVICE_NAME%
echo Done. Service %SERVICE_NAME% is now running.
pause
`;
}

function envExample() {
  return `# BalanceAlert API — Environment Variables
# Copy this to .env or set these as system/service environment variables

# Required: PostgreSQL connection string
DATABASE_URL=postgresql://user:password@localhost:5432/balance_alert

# Required: Secret for session cookie signing (use a long random string)
SESSION_SECRET=change-me-to-a-long-random-secret-at-least-32-chars

# Server port (default: 8080, must match IIS web.config proxy target)
PORT=8080

NODE_ENV=production
`;
}

function deployGuide() {
  return `# BalanceAlert — IIS Deployment Guide

## Folder Structure

\`\`\`
iis-deploy/
├── web/            ← Frontend static files → IIS site root
│   ├── index.html
│   ├── assets/
│   └── web.config  ← IIS configuration (already included)
├── api/            ← Node.js API server
│   ├── dist/       ← Bundled server (esbuild output)
│   ├── start-api.bat
│   ├── install-service.bat
│   └── .env.example
└── DEPLOY.md       ← This file
\`\`\`

---

## Prerequisites (install once on your Windows Server)

| Requirement | Download |
|---|---|
| Node.js 20+ (LTS) | https://nodejs.org |
| IIS with URL Rewrite module | https://www.iis.net/downloads/microsoft/url-rewrite |
| Application Request Routing (ARR) | https://www.iis.net/downloads/microsoft/application-request-routing |
| PostgreSQL 14+ | https://www.postgresql.org/download/windows/ |
| NSSM (optional, for Windows service) | https://nssm.cc/download |

---

## Step 1 — Set Up the Database

1. Create a PostgreSQL database, e.g. \`balance_alert\`
2. Note the connection string: \`postgresql://user:password@localhost:5432/balance_alert\`
3. The app will create its own tables on first start (via Drizzle ORM push)

> **Alternatively**, run the schema push from this machine before deploying:
> \`\`\`
> pnpm --filter @workspace/db run push
> \`\`\`

---

## Step 2 — Deploy the API Server

1. Copy the **\`api/\`** folder to your server, e.g. \`C:\\BalanceAlert\\api\`
2. Edit **\`api/start-api.bat\`** and set your real values:
   \`\`\`bat
   SET DATABASE_URL=postgresql://user:password@localhost:5432/balance_alert
   SET SESSION_SECRET=a-long-random-string-at-least-32-chars
   \`\`\`
3. Test it first — run \`start-api.bat\` in a command prompt and check for errors
4. Install as a persistent Windows service using NSSM:
   - Edit \`api/install-service.bat\` with the same env values
   - **Right-click → Run as Administrator**
   - The API will now start automatically on boot

---

## Step 3 — Enable ARR Proxy in IIS

1. Open **IIS Manager**
2. Click the **server node** (top level) → double-click **Application Request Routing**
3. Click **Server Proxy Settings** (right panel)
4. Check **Enable proxy** → Apply

---

## Step 4 — Create the IIS Website

1. In **IIS Manager**, right-click **Sites** → **Add Website**
2. Site name: \`BalanceAlert\`
3. Physical path: the **\`web/\`** folder from this package (e.g. \`C:\\BalanceAlert\\web\`)
4. Binding: set your hostname / IP and port (e.g. port 80 or 443 for HTTPS)
5. Click **OK**

---

## Step 5 — Verify web.config

The **\`web/web.config\`** is already included and configured to:
- Proxy \`/api/*\` → \`http://localhost:8080\` (your Node.js API)
- Serve \`index.html\` for all frontend routes (SPA fallback)
- Register correct MIME types for modern web assets

If your API runs on a different port, edit the proxy URL in \`web.config\`:
\`\`\`xml
<action type="Rewrite" url="http://localhost:YOUR_PORT/api/{R:1}" />
\`\`\`

---

## Step 6 — HTTPS (Recommended)

1. Install an SSL certificate (Let's Encrypt via win-acme, or your org's certificate)
2. Add an HTTPS binding (port 443) to the IIS site
3. In \`start-api.bat\` / service config, set \`COOKIE_SECURE=true\`

---

## Step 7 — First Login

1. Open your site in a browser
2. Navigate to **Settings** — it will open directly (no TOTP required initially)
3. Enter your **Grafana URL**, **API key**, and configure SMS/SMTP/Telegram
4. Optionally enable **Google Authenticator** in the Security section

---

## Rebuilding After Updates

Run this from the project root on your development machine:

\`\`\`bash
pnpm --filter @workspace/scripts run build-iis
\`\`\`

Then copy the new \`iis-deploy/\` output to your server and replace the \`web/\` folder.
Restart the \`BalanceAlertAPI\` Windows service if API files changed.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| \`/api/*\` returns 404 | Ensure ARR proxy is enabled at server level (Step 3) |
| Blank page / JS errors | Check \`web.config\` is present in the site root |
| API won't start | Run \`start-api.bat\` manually to see the error |
| Session resets on restart | Set a stable \`SESSION_SECRET\` (not random on each start) |
| CORS errors | API and frontend must share the same hostname (IIS proxies them) |
| Database errors on first start | Run schema push: \`pnpm --filter @workspace/db run push\` |
`;
}

main().catch((err) => {
  console.error("\n❌ Build failed:", err.message);
  process.exit(1);
});
