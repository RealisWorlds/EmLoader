# Mindcraft 🧠⛏️

> AI-powered Minecraft agents built with LLMs and Mineflayer

Mindcraft transforms Minecraft gameplay by enabling advanced AI bots powered by large language models (LLMs) to interact with the game world. These intelligent agents can build structures, gather resources, follow players, craft items, and engage in natural conversations - all while learning from their experiences.

[![Discord](https://img.shields.io/discord/1111111111111111111?label=Discord&logo=discord&logoColor=white)](https://discord.gg/mp73p35dzC)
[![YouTube](https://img.shields.io/badge/YouTube-Tutorial-red?logo=youtube&logoColor=white)](https://www.youtube.com/watch?v=gRotoL8P8D8)
[![Blog](https://img.shields.io/badge/Blog-Post-blue?logo=medium&logoColor=white)](https://kolbynottingham.com/mindcraft/)

## 📋 Table of Contents

- [Features](#-features)
- [Requirements](#-requirements)
- [Quick Start](#-quick-start)
- [Configuration](#-configuration)
- [Bot Profiles](#-bot-profiles)
- [Commands and Usage](#-commands-and-usage)
- [Model Support](#-model-support)
- [Connecting to Servers](#-connecting-to-servers)
- [Security and Docker](#-security-and-docker)
- [Troubleshooting](#-troubleshooting)
- [Contributing](#-contributing)

## ✨ Features

- **Multiple AI Models**: Supports OpenAI, Google Gemini, Anthropic Claude, Mistral, Groq, Ollama and more
- **Multi-Agent Support**: Run multiple AI bots simultaneously with different personalities and capabilities
- **Natural Language Interaction**: Talk to your bot using natural language in-game
- **Code Generation**: Bots can write and execute JavaScript to perform complex tasks
- **Memory System**: Bots remember important information from previous interactions
- **Customizable Personalities**: Create unique bot personalities using JSON profiles
- **Behavioral Modes**: Configure bots with different behavioral traits (self-preservation, hunting, etc.)
- **Visual Feedback**: Option to view what the bot sees in a browser window
- **Language Translation**: Support for translating interactions to and from multiple languages
- **Command System**: Rich set of built-in commands for bot control and interaction

> [!CAUTION]
> Do not connect this bot to public servers with coding enabled. This project allows an LLM to write/execute code on your computer. The code is sandboxed, but still vulnerable to injection attacks. Code writing is disabled by default; you can enable it by setting `allow_insecure_coding` to `true` in `settings.js`.

## 🛠 Requirements

- [Minecraft Java Edition](https://www.minecraft.net/en-us/store/minecraft-java-bedrock-edition-pc) (v1.20.4 recommended, supports up to v1.21.1)
- [Node.js](https://nodejs.org/) (v14 or newer)
- An API key from one of the supported LLM providers:
  - [OpenAI](https://openai.com/blog/openai-api)
  - [Google Gemini](https://aistudio.google.com/app/apikey)
  - [Anthropic Claude](https://docs.anthropic.com/claude/docs/getting-access-to-claude)
  - [Mistral AI](https://docs.mistral.ai/getting-started/models/models_overview/)
  - [Groq](https://console.groq.com/keys)
  - [Replicate](https://replicate.com/)
  - [Hugging Face](https://huggingface.co/)
  - [Novita AI](https://novita.ai/settings?utm_source=github_mindcraft&utm_medium=github_readme&utm_campaign=link#key-management)
  - [Qwen](https://www.alibabacloud.com/help/en/model-studio/developer-reference/get-api-key)
  - [Ollama](https://ollama.com/download) (local, no API key required)

## 🚀 Quick Start

1. **Setup API Keys, Configure Settings**:
   ```
   A) cp keys.example.json keys.json
   B) Edit `keys.json` and add your preferred API key(s)
   C) cp settings.example.js settings.js
   D) Edit `settings.js` and configure your settings
   E) Create a profile for the bot
      - You can use the EmGenerator or manually create a profile
        - Manual method: 
          - copy an existing bot profile and name it- e.g. George.json
          - Edit the new profile as you like
          - Add the profile to settings.js under "profiles":
   ```

2. **Install Dependencies**:
   ```
   npm install (install dependencies)
   ```

3 **Setup Daemon and Auto-Updates, Run the bot**:
   ```
   npm run setup
   pm2 start ecosystem.config.js
   pm2 save
   pm2 startup
   ```
  **Additional PM2 Commands**:
  # Force an update from GitHub
  pm2 reload EmFramework
  # View all logs
  pm2 logs EmFramework --lines 50
  # Stop the process
  pm2 stop EmFramework
  # Restart the process
  pm2 restart EmFramework
  # Delete the process
  pm2 delete EmFramework
  # Save current process list (important for auto-start)
  pm2 save
  # Check PM2 Status of running Ems
  pm2 status
  # Start interactive monitoring
  pm2 monit

**Running the bot in standalone mode**:

3. **Start Minecraft**:
   - Launch Minecraft Java Edition (v1.20.4 recommended)
   - Create a new world or load an existing one
   - Open to LAN with port `55916` (or configure in `settings.js`)

4. **Launch a Bot**:
   ```
   node main.js
   ```
   Or for a specific profile:
   ```
   node main.js --profiles ./profiles/BobVilaAI.json
   ```

5. **Interact with Your Bot**:
   - Talk to your bot in the Minecraft chat
   - Send commands or natural language requests

## ⚙️ Configuration

The main configuration is in `settings.js`. Key settings include:

| Setting | Description | Default |
|---------|-------------|---------|
| `minecraft_version` | Minecraft version to connect to | `"1.21.4"` |
| `host` | Server hostname/IP | `"localhost"` |
| `port` | Server port | `25565` |
| `auth` | Authentication type | `"offline"` |
| `base_profile` | Default profile for all bots | `"./profiles/defaults/survival.json"` |
| `profiles` | List of bot profiles to load | `["./profiles/BobVilaAI.json"]` |
| `allow_insecure_coding` | Enable bot code generation | `true` |
| `load_memory` | Load bot memory from previous sessions | `true` |
| `only_chat_with` | Users the bot will exclusively chat with | `[]` |
| `language` | Translation language | `"en"` |
| `show_bot_views` | Show visual bot perspective in browser | `false` |
| `max_messages` | Messages kept in bot context | `15` |
| `num_examples` | Example interactions given to the bot | `2` |

## 🤖 Bot Profiles

Bot profiles are JSON files in the `profiles` directory that define:

1. **Bot Personality**: How the bot behaves and communicates
2. **Model Configuration**: Which LLM models to use for different functions
3. **Behavioral Modes**: Special capabilities and tendencies
4. **Examples**: Sample interactions that teach the bot how to respond

Example profile structure:
```json
{
  "name": "BobVilaAI",
  "model": "deepseek-chat",
  "embedding": "openai",
  "conversing": "You are BobVilaAI...",
  "coding": "You are an intelligent mineflayer bot...",
  "saving_memory": "You are a minecraft bot named BobVilaAI...",
  "modes": {
    "self_preservation": false,
    "unstuck": false,
    "cowardice": false,
    "self_defense": false,
    "hunting": false,
    "item_collecting": false,
    "torch_placing": false,
    "elbow_room": false,
    "idle_staring": true,
    "cheat": true
  }
}
```

## 🎮 Commands and Usage

### Launch Commands

| Command | Description |
|---------|-------------|
| `node main.js` | Start with default profile from settings.js |
| `node main.js --profiles ./profiles/BobVilaAI.json` | Start with a specific profile |
| `node main.js --profiles ./profiles/bot1.json ./profiles/bot2.json` | Start multiple bots |
| `node main.js --host_mindserver false` | Start without hosting the mindserver |
| `npm start` | Alias for `node main.js` |

### Helper Scripts

| Script | Description |
|--------|-------------|
| `start_agent.bat [profile_name] [host_mindserver]` | Launch a bot with a specific profile (Windows) |
| `start_agent.ps1` | Interactive PowerShell script to select and launch a bot (Windows) |
| `run_multiple_agents.bat` | Launch predefined multiple bots (Windows) |
| `run_multiple_agents_improved.bat` | Interactive script to select and launch multiple bots (Windows) |

### In-Game Commands

Bots understand natural language and various commands, including:

| Command Type | Examples |
|--------------|----------|
| Movement | "Come here", "Follow me", "Go to the forest" |
| Building | "Build a house", "Make a tower", "Dig a hole" |
| Collecting | "Collect wood", "Mine some stone", "Gather food" |
| Crafting | "Craft wooden planks", "Make a pickaxe", "Smelt iron ore" |
| Combat | "Kill that zombie", "Attack the skeleton", "Defend yourself" |
| Information | "What do you see?", "What's in your inventory?", "Where are we?" |

## 🧠 Model Support

You can specify models in profiles using either a simple string or a detailed configuration object:

```json
"model": "gpt-4o"
```

Or with custom configuration:

```json
"model": {
  "api": "openai",
  "model": "gpt-4o",
  "params": {
    "max_tokens": 1000,
    "temperature": 1
  }
},
"code_model": {
  "api": "openai",
  "model": "gpt-4"
},
"embedding": {
  "api": "openai",
  "model": "text-embedding-ada-002"
}
```

### Supported APIs and Models

| API | Config Variable | Example Models |
|-----|----------------|----------------|
| `openai` | `OPENAI_API_KEY` | `gpt-4o`, `gpt-4o-mini`, `gpt-3.5-turbo` |
| `google` | `GEMINI_API_KEY` | `gemini-pro`, `gemini-1.5-pro` |
| `anthropic` | `ANTHROPIC_API_KEY` | `claude-3-opus`, `claude-3-sonnet`, `claude-3-haiku` |
| `ollama` | n/a | `llama3`, `mixtral` |
| `groq` | `GROQCLOUD_API_KEY` | `llama-3-8b-8192`, `mixtral-8x7b-32768` |
| `mistral` | `MISTRAL_API_KEY` | `mistral-large-latest`, `mistral-medium` |
| `huggingface` | `HUGGINGFACE_API_KEY` | `mistralai/Mistral-7B-Instruct-v0.2` |
| `replicate` | `REPLICATE_API_KEY` | `meta/llama-3-70b-instruct` |
| `novita` | `NOVITA_API_KEY` | `gryphe/mythomax-l2-13b` |
| `qwen` | `QWEN_API_KEY` | `qwen-max`, `qwen-turbo` |
| `openrouter` | `OPENROUTER_API_KEY` | `anthropic/claude-3.5-sonnet` |

## 🌐 Connecting to Servers

### Online Servers
To connect to online servers, you need a Microsoft/Minecraft account. Update `settings.js`:

```javascript
"host": "server.address.com",
"port": 25565,
"auth": "microsoft",
```

> [!IMPORTANT]
> The bot's name in the profile.json must exactly match the Minecraft profile name to prevent the bot from chatting with itself.

To use different accounts, Mindcraft connects with the account currently active in the Minecraft launcher.

## 🔒 Security and Docker

If you enable insecure coding (`allow_insecure_coding: true`), it's recommended to run Mindcraft in a Docker container:

```bash
docker-compose up
```

Or manually:

```bash
docker run -i -t --rm -v $(pwd):/app -w /app -p 3000-3003:3000-3003 node:latest node main.js
```

When running in Docker, use `host.docker.internal` in `settings.js` to connect to your local Minecraft server:

```javascript
"host": "host.docker.internal",
```

## 🔧 Troubleshooting

Common issues and solutions:

| Issue | Solution |
|-------|----------|
| Connection refused | Ensure Minecraft is open to LAN with correct port |
| Module not found | Run `npm install` to install dependencies |
| "My brain disconnected" | Check API key and rate limits |
| Bot getting stuck | Update and reinstall node modules |
| API key not found | Rename `keys.example.json` to `keys.json` and save changes |

For more troubleshooting help, see the [FAQ](FAQ.md) or join our [Discord](https://discord.gg/mp73p35dzC).

## 👥 Contributing

Contributions are welcome! Check the [Contributor TODO](https://github.com/users/kolbytn/projects/1) for current priorities.

To add patches for node modules, modify the local module file and run:
```
npx patch-package [package-name]
```

## 📝 Citation

```
@misc{mindcraft2023,
    Author = {Kolby Nottingham and Max Robinson},
    Title = {MINDcraft: LLM Agents for cooperation, competition, and creativity in Minecraft},
    Year = {2023},
    url = {https://github.com/kolbytn/mindcraft}
}
