# ⚡ Edwin PAI — Quick Start

## Option 1: Install Script (recommended)

```bash
# One-line install
curl -fsSL https://edwinpai.com/install.sh | bash

# Set your API key
export ANTHROPIC_API_KEY=sk-ant-...

# Start Edwin
edwin gateway start
```

## Option 2: Manual Install

```bash
# Clone
git clone https://github.com/onchaininnovation/edwin.git
cd edwin

# Install & build
pnpm install
pnpm build

# Install globally
npm install -g .

# Configure
edwinpai setup
nano ~/.edwinpai/edwinpai.json

# Run
export ANTHROPIC_API_KEY=sk-ant-...
edwinpai gateway start
```

## Option 3: Docker

```bash
# Clone
git clone https://github.com/onchaininnovation/edwin.git
cd edwin

# Configure
mkdir -p ~/.edwinpai
nano ~/.edwinpai/edwinpai.json

# Run
ANTHROPIC_API_KEY=sk-ant-... docker compose -f docker-compose.edwinpai.yml up -d
```

## Connect a Channel

### WhatsApp

```json5
// In ~/.edwinpai/edwinpai.json
whatsapp:
  enabled: true
```

Start Edwin, then scan the QR code that appears.

### Telegram

```json5
telegram:
  enabled: true
  token: YOUR_BOT_TOKEN # Get from @BotFather
```

### Signal

```json5
signal:
  enabled: true
```

## Verify It's Working

```bash
# Check status
edwin status

# View logs
edwin logs

# Open the web UI
open http://localhost:3000
```

## Multiple Instances

Run multiple instances with separate configs:

```bash
# Marketing
EDWINPAI_HOME=~/.edwinpai-marketing edwinpai gateway start

# Support
EDWINPAI_HOME=~/.edwinpai-support edwinpai gateway start

# DevOps
EDWINPAI_HOME=~/.edwinpai-devops edwinpai gateway start
```

Each instance gets its own data directory, crypto keys, and channel connections.

## Need Help?

- Docs: https://edwinpai.com/docs
- Email: jake@onchaininnovation.com
- Twitter: @monkishrex
