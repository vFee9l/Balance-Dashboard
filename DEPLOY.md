# Balance Alert — Ubuntu Deployment Guide

Deploy the full stack (API + React frontend) on a single port (3030) without nginx.  
The Express API server also serves the React SPA static files in production mode.

---

## Prerequisites

### Node.js 24

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v   # should print v24.x.x
```

### pnpm

```bash
npm install -g pnpm
pnpm -v
```

### pm2 (process manager)

```bash
npm install -g pm2
```

### PostgreSQL

```bash
sudo apt-get install -y postgresql postgresql-contrib
sudo systemctl enable postgresql
sudo systemctl start postgresql
```

---

## Database Setup

```bash
sudo -u postgres psql <<'SQL'
CREATE USER balancedash WITH PASSWORD 'CHANGE_THIS_PASSWORD';
CREATE DATABASE balancdash OWNER balancedash;
GRANT ALL PRIVILEGES ON DATABASE balancdash TO balancedash;
SQL
```

> **Important:** Replace `CHANGE_THIS_PASSWORD` with a strong password and keep it for the next step.

---

## Project Setup

### 1. Clone the repository

```bash
sudo mkdir -p /opt/balance-alert
sudo chown $USER:$USER /opt/balance-alert
git clone https://github.com/vFee9l/Balance-Alert /opt/balance-alert
cd /opt/balance-alert
```

### 2. Install dependencies

```bash
pnpm install
```

### 3. Create the environment file

```bash
cat > /opt/balance-alert/.env <<'EOF'
NODE_ENV=production
PORT=3030
BASE_PATH=/
DATABASE_URL=postgresql://balancedash:CHANGE_THIS_PASSWORD@localhost:5432/balancdash
SESSION_SECRET=CHANGE_THIS_TO_A_LONG_RANDOM_STRING
EOF
```

> Generate a strong `SESSION_SECRET`:
> ```bash
> node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
> ```

---

## Build

```bash
cd /opt/balance-alert

# Load env vars for the build
export $(grep -v '^#' .env | xargs)

# Build the React frontend (outputs to artifacts/balance-alerts/dist/public)
pnpm --filter @workspace/balance-alerts run build

# Build the API server (outputs to artifacts/api-server/dist/index.mjs)
pnpm --filter @workspace/api-server run build
```

---

## Database Migration

Push the schema to create all tables:

```bash
cd /opt/balance-alert
export $(grep -v '^#' .env | xargs)
pnpm --filter @workspace/db run push
```

---

## Run with pm2

pm2 reads environment variables from the `ecosystem.config.cjs` file, which in turn loads them from `.env`.

### Start the application

```bash
cd /opt/balance-alert
pm2 start ecosystem.config.cjs
pm2 save
```

### Enable auto-start on system boot

```bash
pm2 startup
# Run the command that pm2 prints — it looks like:
# sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u $USER --hp $HOME
pm2 save
```

### Check status

```bash
pm2 status
pm2 logs balance-alert
```

The application will be available at: **http://localhost:3030**

---

## Verify

```bash
# Health check
curl http://localhost:3030/api/healthz

# Should return: {"status":"ok"}
```

---

## pm2 Commands Reference

| Command | Description |
|---|---|
| `pm2 status` | Show running processes |
| `pm2 logs balance-alert` | Tail live logs |
| `pm2 restart balance-alert` | Restart the app |
| `pm2 stop balance-alert` | Stop the app |
| `pm2 delete balance-alert` | Remove from pm2 |

---

## Firewall (optional)

To expose port 3030 externally:

```bash
sudo ufw allow 3030/tcp
sudo ufw reload
```

---

## Update

Run the included update script to pull the latest code and redeploy:

```bash
bash /opt/balance-alert/scripts/update.sh
```

See `scripts/update.sh` for details.
