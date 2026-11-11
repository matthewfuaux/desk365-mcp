#!/usr/bin/env node
/**
 * Desk365 MCP server.
 *
 * Environment variables:
 *   DESK365_API_KEY     (required) API key from Desk365 → Settings → Integrations → API
 *   DESK365_SUBDOMAIN   your Desk365 subdomain, e.g. "contoso" for contoso.desk365.io
 *   DESK365_BASE_URL    alternative to DESK365_SUBDOMAIN, e.g. https://contoso.desk365.io/apis
 *   DESK365_READ_ONLY   "true" to expose only GET (read) tools
 *   DESK365_TAGS        comma-separated tag filter, e.g. "Tickets,Contacts,Companies"
 *   DESK365_TOOLS       comma-separated tool-name allow-list (overrides nothing else; applied last)
 *   DESK365_TIMEOUT_MS  HTTP timeout, default 60000
 *
 * Run with `--list-tools` to print the generated tools and exit.
 */
import { fileURLToPath } from 'node:url';
import { McpServer, fromJsonSchema } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { buildTools, loadSpec, type ToolDef } from './openapi.js';
import { callDesk365, type Desk365Config } from './client.js';

const SPEC_PATH = fileURLToPath(new URL('../openapi/desk365.json', import.meta.url));
const MAX_RESPONSE_CHARS = 200_000;

function csv(value: string | undefined): string[] {
    return (value ?? '')
        .split(',')
        .map(s => s.trim().toLowerCase())
        .filter(Boolean);
}

function selectTools(all: ToolDef[]): ToolDef[] {
    const readOnly = /^(1|true|yes)$/i.test(process.env.DESK365_READ_ONLY ?? '');
    const tags = csv(process.env.DESK365_TAGS);
    const names = csv(process.env.DESK365_TOOLS);
    return all.filter(
        t =>
            (!readOnly || t.method === 'GET') &&
            (tags.length === 0 || tags.includes(t.tag.toLowerCase())) &&
            (names.length === 0 || names.includes(t.name))
    );
}

function resolveBaseUrl(): string {
    if (process.env.DESK365_BASE_URL) return process.env.DESK365_BASE_URL;
    const sub = process.env.DESK365_SUBDOMAIN?.trim();
    if (!sub) throw new Error('Set DESK365_SUBDOMAIN (e.g. "contoso") or DESK365_BASE_URL.');
    const host = sub.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    return `https://${host.includes('.') ? host : `${host}.desk365.io`}/apis`;
}

function annotationsFor(tool: ToolDef) {
    return {
        title: tool.title,
        readOnlyHint: tool.method === 'GET',
        destructiveHint: tool.method === 'DELETE' || tool.method === 'PUT',
        idempotentHint: tool.method === 'GET' || tool.method === 'PUT' || tool.method === 'DELETE',
        openWorldHint: true
    };
}

async function main() {
    const spec = loadSpec(SPEC_PATH);
    const tools = selectTools(buildTools(spec));

    if (process.argv.includes('--list-tools')) {
        for (const t of tools) console.log(`${t.method.padEnd(6)} ${t.name.padEnd(52)} ${t.title}`);
        console.log(`\n${tools.length} tools`);
        return;
    }

    const apiKey = process.env.DESK365_API_KEY;
    if (!apiKey) throw new Error('DESK365_API_KEY is not set.');
    const config: Desk365Config = {
        apiKey,
        baseUrl: resolveBaseUrl(),
        timeoutMs: Number(process.env.DESK365_TIMEOUT_MS ?? 60_000)
    };

    const server = new McpServer(
        { name: 'desk365', version: '1.0.0' },
        {
            instructions:
                'Tools for the Desk365 helpdesk (tickets, contacts, companies, time entries, knowledge base, surveys, ' +
                'contracts and asset management). List endpoints are paginated with `offset`. Ticket priority codes: ' +
                'Low=1, Medium=5, High=10, Urgent=20. Use the *_details tools to fetch a single record.'
        }
    );

    for (const tool of tools) {
        server.registerTool(
            tool.name,
            {
                title: tool.title,
                description: tool.description,
                inputSchema: fromJsonSchema<Record<string, unknown>>(tool.inputSchema as any),
                annotations: annotationsFor(tool)
            },
            async args => {
                try {
                    const res = await callDesk365(config, tool, args ?? {});
                    let text = typeof res.data === 'string' ? res.data : JSON.stringify(res.data, null, 2);
                    if (text.length > MAX_RESPONSE_CHARS) {
                        text = text.slice(0, MAX_RESPONSE_CHARS) + `\n… [truncated ${text.length - MAX_RESPONSE_CHARS} chars; use offset/filters to narrow]`;
                    }
                    if (!res.ok) {
                        return {
                            isError: true,
                            content: [{ type: 'text', text: `Desk365 API error ${res.status} ${res.statusText}\n${text}` }]
                        };
                    }
                    return { content: [{ type: 'text', text: text || `${res.status} ${res.statusText}` }] };
                } catch (err) {
                    return {
                        isError: true,
                        content: [{ type: 'text', text: `Request failed: ${err instanceof Error ? err.message : String(err)}` }]
                    };
                }
            }
        );
    }

    await server.connect(new StdioServerTransport());
    console.error(`desk365-mcp: ${tools.length} tools registered against ${config.baseUrl}`);
}

main().catch(err => {
    console.error(`desk365-mcp: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
});
