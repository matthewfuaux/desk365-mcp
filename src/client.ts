import { openAsBlob } from 'node:fs';
import { basename } from 'node:path';
import type { ToolDef } from './openapi.js';

export interface Desk365Config {
    baseUrl: string;
    apiKey: string;
    timeoutMs: number;
}

export interface Desk365Response {
    ok: boolean;
    status: number;
    statusText: string;
    data: unknown;
}

function encodeParam(value: unknown, jsonString: boolean): string {
    if (typeof value === 'string') return value;
    if (jsonString || (value !== null && typeof value === 'object')) return JSON.stringify(value);
    return String(value);
}

/** Executes the HTTP request described by `tool` with the arguments supplied by the MCP client. */
export async function callDesk365(config: Desk365Config, tool: ToolDef, args: Record<string, unknown>): Promise<Desk365Response> {
    let path = tool.path;
    const query = new URLSearchParams();
    const headers: Record<string, string> = {
        Authorization: config.apiKey,
        Accept: 'application/json, */*'
    };

    for (const param of tool.params) {
        const value = args[param.name];
        if (value === undefined || value === null || value === '') continue;
        const encoded = encodeParam(value, param.jsonString);
        if (param.in === 'path') path = path.replace(`{${param.name}}`, encodeURIComponent(encoded));
        else if (param.in === 'header') headers[param.name] = encoded;
        else query.set(param.name, encoded);
    }

    const url = new URL(config.baseUrl.replace(/\/+$/, '') + path);
    url.search = query.toString();

    let body: BodyInit | undefined;
    if (tool.body === 'json' && args.body !== undefined) {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(args.body);
    } else if (tool.body === 'multipart') {
        const filePaths = (args.file_paths as string[] | undefined) ?? [];
        const form = new FormData();
        // Desk365 uses `file` for a single attachment and `files` for several.
        const field = filePaths.length > 1 ? 'files' : 'file';
        for (const filePath of filePaths) {
            let blob: Blob;
            try {
                blob = await openAsBlob(filePath);
            } catch {
                throw new Error(`Cannot read attachment "${filePath}" (path must exist on the machine running the MCP server)`);
            }
            form.append(field, blob, basename(filePath));
        }
        body = form; // fetch sets the multipart boundary header itself
    }

    const response = await fetch(url, {
        method: tool.method,
        headers,
        body,
        signal: AbortSignal.timeout(config.timeoutMs)
    });

    const text = await response.text();
    let data: unknown = text;
    try {
        data = text ? JSON.parse(text) : null;
    } catch {
        // keep raw text
    }
    return { ok: response.ok, status: response.status, statusText: response.statusText, data };
}
