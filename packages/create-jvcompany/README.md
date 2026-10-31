# create-jvcompany

Create a new **[JVCompany](https://github.com/inuxmax/JVcompany)** — an open-source, self-hosted software company run by AI agents (Claude Code, OpenAI Codex, Gemini CLI, any LLM) inside a live 3D office — with one command.

```bash
npx create-jvcompany@latest
```

It will:

1. Download the latest JVCompany source from GitHub (`git clone`, or the source archive when git is missing).
2. Create `.env.local` with your MongoDB connection string and database name.
3. Check that MongoDB is running — and offer to start it in Docker if it isn't.
4. Install the dependencies (`npm ci`).
5. Start the app and open **http://127.0.0.1:2501**, where a 4-step setup creates your company.

## Requirements

- **Node.js 20+**
- **MongoDB** — local, Docker or MongoDB Atlas
- *(optional)* signed-in agent CLIs: `claude`, `codex`, `gemini`, `cursor-agent`, `copilot`, `qwen`, `opencode`

## Options

```bash
npx create-jvcompany@latest my-office --yes
```

| Option | Description |
|---|---|
| `[directory]` | Where to create the company (default `jvcompany`) |
| `-y, --yes` | Use the defaults and ask nothing |
| `--no-install` | Download only, skip `npm install` |
| `--no-start` / `--start` | Don't start / start the app at the end without asking |
| `--ref <branch\|tag>` | Git branch or tag to download (default `main`) |
| `--mongodb-uri <uri>` | MongoDB connection string (default `mongodb://127.0.0.1:27017`) |
| `--db <name>` | Database name (default `jvcompany`) |

No MongoDB yet? Start one with Docker:

```bash
docker run -d --name jvcompany-mongo -p 27017:27017 -v jvcompany-mongo:/data/db mongo:8
```

## Updating

Inside the created folder:

```bash
git pull && npm install
```

## License

[MIT](https://github.com/inuxmax/JVcompany/blob/main/LICENSE)
