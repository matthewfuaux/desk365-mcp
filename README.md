# desk365-mcp

An [MCP](https://modelcontextprotocol.io) server for the [Desk365](https://www.desk365.io) helpdesk API, built with the
[MCP TypeScript SDK v2](https://github.com/modelcontextprotocol/typescript-sdk) (`@modelcontextprotocol/server`).

The server reads `openapi/desk365.json` (the Desk365 v3 OpenAPI spec) at startup and creates one tool per API
operation: 101 tools covering tickets, contacts, companies, time entries, surveys, the knowledge base, contracts and
asset management.

## Setup

```bash
npm install
npm run build
```

Requires Node.js 20 or later.

## Configuration

| Variable             | Required | Description                                                                           |
| -------------------- | -------- | ------------------------------------------------------------------------------------- |
| `DESK365_API_KEY`    | yes      | API key from Desk365 (Settings → Integrations → API)                                  |
| `DESK365_SUBDOMAIN`  | yes\*    | Your subdomain, e.g. `contoso` for `contoso.desk365.io`                               |
| `DESK365_BASE_URL`   | yes\*    | Alternative to the subdomain, e.g. `https://contoso.desk365.io/apis`                  |
| `DESK365_READ_ONLY`  | no       | `true` registers only the read (GET) tools                                            |
| `DESK365_TAGS`       | no       | Comma-separated tool groups to expose, e.g. `Tickets,Contacts,Companies,Time entries` |
| `DESK365_TOOLS`      | no       | Comma-separated allow-list of tool names                                              |
| `DESK365_TIMEOUT_MS` | no       | HTTP timeout in milliseconds (default `60000`)                                        |

\* Set either `DESK365_SUBDOMAIN` or `DESK365_BASE_URL`.

Tool groups (tags): Ping, Tickets, Contacts, Companies, Time entries, Surveys, KB Categories, KB Folders, KB Articles,
Assets, Asset Types & Fields, Products, Vendors, Depreciations, Locations, Softwares, Software Fields, Contracts.

Some clients slow down or get less accurate when they have 100+ tools. Use `DESK365_TAGS` or `DESK365_READ_ONLY` to
expose fewer.

To print the tools that the current filters produce:

```bash
DESK365_TAGS=Tickets npm run list-tools
```

## Using it with Claude Code

```bash
claude mcp add desk365 \
  -e DESK365_API_KEY=your-key \
  -e DESK365_SUBDOMAIN=yoursubdomain \
  -- node /absolute/path/to/desk365-mcp/dist/index.js
```

## Using it with Claude Desktop or other clients

```json
{
  "mcpServers": {
    "desk365": {
      "command": "node",
      "args": ["/absolute/path/to/desk365-mcp/dist/index.js"],
      "env": {
        "DESK365_API_KEY": "your-key",
        "DESK365_SUBDOMAIN": "yoursubdomain"
      }
    }
  }
}
```

## How tools map to the API

- Tool names come from the path: `PUT /v3/tickets/update` becomes `tickets_update`, and list endpoints get a `_list`
  suffix (`tickets_list`, `contacts_list`).
- Query parameters are top-level arguments. A JSON request body goes in the `body` argument.
- Parameters that Desk365 expects as JSON strings (`filters`, `filterJson`, `ticket_object`, `reply_object`, …) can be
  passed as plain objects. The server JSON-encodes them.
- The `*_with_attachment` tools take `file_paths`, a list of local file paths on the machine running the server. They
  are uploaded as `file` (one file) or `files` (several), as Desk365 requires.
- Tool annotations mark GET tools as read-only and DELETE/PUT tools as destructive, so clients can ask for confirmation.
- Non-2xx responses come back as tool errors that include the status and the response body.

## Updating the spec

Replace `openapi/desk365.json` with a newer export (from `https://<subdomain>.desk365.io/apis/api-docs.html`) and
restart the server. The tools are rebuilt from the file at every startup, so you don't need to change any code.
