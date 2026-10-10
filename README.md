# open-excel

An open-source Claude for Excel clone. A Microsoft Office Excel Add-in with an integrated AI chat interface. This fork supports both the original bring-your-own-key (BYOK) workflow and a managed OpenAI-compatible gateway workflow.

https://github.com/user-attachments/assets/50f3ba42-4daa-49d8-b31e-bae9be6e225b

> **Reference:** The original Claude for Excel system prompt, tools spec, and RPC protocol were reverse-engineered and documented at [hewliyang/reversing/claude-for-excel](https://github.com/hewliyang/reversing/tree/main/claude-for-excel).

## Installation (End Users)

Download [`manifest.prod.xml`](./manifest.prod.xml) and follow the instructions for your platform:

### Windows

1. Open Excel
2. Go to **Insert** → **Add-ins** → **My Add-ins**
3. Click **Upload My Add-in**
4. Browse to `manifest.prod.xml` and click OK
5. Click **"Open AI Chat"** in the Home tab ribbon

### macOS

1. Copy `manifest.prod.xml` to:
   ```
   ~/Library/Containers/com.microsoft.Excel/Data/Documents/wef/
   ```
   You can do this via Terminal:
   ```bash
   mkdir -p ~/Library/Containers/com.microsoft.Excel/Data/Documents/wef
   cp manifest.prod.xml ~/Library/Containers/com.microsoft.Excel/Data/Documents/wef/
   ```
2. Quit and reopen Excel
3. Go to **Insert** → **Add-ins** → **My Add-ins**
4. Select "OpenExcel" under **Shared Folder**

### Excel for Web

1. Open a workbook at [excel.office.com](https://excel.office.com)
2. Click **Insert** → **Add-ins** → **More Add-ins**
3. Click **Upload My Add-in**
4. Upload `manifest.prod.xml`

> **Note:** The "Upload My Add-in" option may be disabled by your organization's IT admin.

---

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or higher recommended)
- Microsoft Excel (desktop version)
- pnpm (or npm/yarn)

### Setup

```bash
pnpm install
```

### Start Dev Server

This command starts the dev server and sideloads the add-in into Excel:

```bash
pnpm start
```

Excel will launch automatically with the add-in loaded in the taskpane.

### Stop the Add-in

```bash
pnpm stop
```

### Production Builds

The default production build remains the BYOK build:

```bash
pnpm build
# equivalent to:
pnpm build:byok
```

Build the managed enterprise gateway variant with:

```bash
pnpm build:gateway
```

Both variants use the same source tree. The build mode is injected at compile time so a gateway build does not expose the BYOK provider/API-key setup UI.

### Deploy to Production

The existing deploy command builds the default BYOK variant and deploys it to Cloudflare Pages:

```bash
pnpm deploy
```

### Other Commands

| Command | Description |
|---------|-------------|
| `pnpm dev-server` | Start dev server only (https://localhost:3000) |
| `pnpm build` | Production BYOK build |
| `pnpm build:byok` | Explicit BYOK production build |
| `pnpm build:gateway` | Managed gateway production build |
| `pnpm deploy` | Build the BYOK variant and deploy to Cloudflare Pages |
| `pnpm lint` | Run linter |
| `pnpm typecheck` | TypeScript type checking |
| `pnpm validate` | Validate the Office manifest |

## Claude for Excel Parity

### Spreadsheet Tools (11)

| Tool | Description |
|------|-------------|
| `get_cell_ranges` | Read cell values, formulas, and formatting |
| `get_range_as_csv` | Pull data as CSV (great for analysis) |
| `search_data` | Find text across the spreadsheet |
| `get_all_objects` | List charts, pivot tables, etc. |
| `set_cell_range` | Write values, formulas, and formatting |
| `clear_cell_range` | Clear cells (content, formatting, or both) |
| `copy_to` | Copy ranges with formula translation |
| `modify_sheet_structure` | Insert/delete/hide/freeze rows/columns |
| `modify_workbook_structure` | Create/delete/rename sheets |
| `resize_range` | Adjust column widths and row heights |
| `modify_object` | Create/update/delete charts and pivot tables |

### Original Tools (1)

| Tool | Description |
|------|-------------|
| `eval_officejs` | Execute arbitrary Office.js code within Excel.run context (escape hatch) |

### Non-Spreadsheet Tools (4)

These are not implemented for obvious reasons. I guess we can do it as BYOK w/ some sandbox & search API providers as well.

| Tool | Description |
|------|-------------|
| `code_execution` | Python with RPC to the sheet (pandas, numpy, etc.) |
| `text_editor_code_execution` | Create/edit files |
| `bash_code_execution` | Run shell commands |
| `web_search` | Search the internet for current info |

## Configuration

### BYOK build

Open the Settings tab and configure:

1. **Provider** - Select the existing LLM provider.
2. **Credential** - Use the provider credential supported by the existing integration. Existing OAuth credential paths remain supported; for example, Anthropic accepts Claude OAuth tokens as well as API keys.
3. **Connect / Refresh Models** - Explicitly query the provider for its current models when a compatible model-list API is available.
4. **Model** - Choose a model returned by live discovery.

Live discovery is preferred over the bundled `pi-ai` catalog. OpenExcel only removes models that can be clearly identified as non-chat models (for example embedding, moderation, transcription, TTS, or image-generation models). Unknown/new chat models remain visible. Providers that cannot be enumerated through a compatible endpoint fall back to the bundled catalog and expose a manual model-ID field.

Existing provider authentication behavior is otherwise unchanged.

### Managed gateway build

The gateway build removes provider selection, provider credentials, and provider proxy configuration from the add-in. The Settings tab contains:

1. **Gateway URL** - User-editable OpenAI-compatible gateway endpoint using either HTTP or HTTPS.
2. **Connect / Refresh Models** - Calls the gateway model endpoint.
3. **Model** - Shows the real model names returned by the gateway.

If the configured URL does not end in `/v1`, OpenExcel appends it automatically. The gateway is expected to support:

```text
GET  /v1/models
POST /v1/chat/completions
```

`/v1/chat/completions` must support streaming and OpenAI-compatible tool/function calling so the existing Excel agent loop can continue executing spreadsheet tools.

Gateway mode intentionally connects directly from the Office taskpane rather than using the BYOK/local CORS proxy. HTTP and HTTPS Gateway URLs are accepted, but the gateway must permit CORS from the add-in origin and an HTTP endpoint can still be blocked by the Office WebView/browser mixed-content policy when the taskpane itself is HTTPS. The add-in does not send a provider API key or plugin-generated `Authorization` header in gateway mode; enterprise identity, authorization, provider credentials, routing, quotas, and the model catalog remain gateway responsibilities.

### Persistence

BYOK and gateway settings use separate localStorage entries. A previously selected model/configuration is restored when Excel reopens. Model discovery is never triggered automatically on startup; the user explicitly chooses **Connect / Refresh Models** when they want to refresh the catalog.

## License

MIT
