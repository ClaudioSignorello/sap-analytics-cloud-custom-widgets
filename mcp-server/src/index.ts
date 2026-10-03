#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SacClient } from "./sacClient.js";
import { registerTools } from "./tools.js";

const readOnly = process.env.SAC_READ_ONLY !== "false";
const server = new McpServer({ name: "sac-mcp-server", version: "0.1.0" });
registerTools(server, SacClient.fromEnv(), { readOnly });

await server.connect(new StdioServerTransport());
console.error(`sac-mcp-server läuft (stdio, ${readOnly ? "nur lesend" : "lesend und schreibend"})`);
