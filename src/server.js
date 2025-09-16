#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import axios from "axios";
import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import { PerplexityTool } from "./tools/perplexity.js";

// Load environment variables
dotenv.config();

// Configuration from environment variables
const JIRA_CONFIG = {
  baseUrl: process.env.JIRA_BASE_URL || "https://username.atlassian.net",
  email: process.env.JIRA_EMAIL,
  apiToken: process.env.JIRA_API_TOKEN,
};

class LocalMCPServer {
  constructor() {
    // Initialize tool instances
    this.perplexityTool = new PerplexityTool();

    // Declare tools in capabilities.tools
    this.server = new Server(
      { name: "local-mcp-server", version: "1.0.0" },
      {
        capabilities: {
          tools: {},
          resources: {},
        },
      }
    );

    // Handlers for MCP protocol methods
    this.server.setRequestHandler(ListToolsRequestSchema, async () =>
      this.handleListTools()
    );

    this.server.setRequestHandler(ListResourcesRequestSchema, async () =>
      this.handleListResources()
    );

    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) =>
      this.handleReadResource(request)
    );

    this.server.setRequestHandler(CallToolRequestSchema, async (request) =>
      this.handleCall(request)
    );
  }

  async handleListTools() {
    return {
      tools: [
        {
          name: "add_numbers",
          description: "Add multiple numbers together (minimum 2 numbers)",
          inputSchema: {
            type: "object",
            properties: {
              numbers: {
                type: "array",
                items: { type: "number" },
                minItems: 2,
                description: "Array of numbers to add together",
              },
            },
            required: ["numbers"],
          },
        },
        {
          name: "fetch_jira_ticket",
          description: "Fetch a JIRA ticket by its key (e.g., PROJ-123)",
          inputSchema: {
            type: "object",
            properties: {
              ticketKey: {
                type: "string",
                description: "JIRA ticket key (e.g., PROJ-123)",
                pattern: "^[A-Z]+-[0-9]+$",
              },
            },
            required: ["ticketKey"],
          },
        },
        this.perplexityTool.getToolDefinition(),
      ],
    };
  }

  async handleListResources() {
    return {
      resources: [],
    };
  }

  async handleReadResource(request) {
    throw new McpError(ErrorCode.InvalidRequest, "No resources available");
  }

  async handleCall(request) {
    const { name, arguments: args, _auth } = request.params || {};
    console.error("Tool called:", name, args ? Object.keys(args) : "no args");

    if (!name) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        "Missing tool name in request"
      );
    }

    try {
      switch (name) {
        case "add_numbers":
          return this.handleAddNumbers(args);
        case "fetch_jira_ticket":
          return this.handleFetchJiraTicket(args);
        case "fetch_perplexity_data":
          return this.perplexityTool.execute(args, _auth);
        default:
          throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
      }
    } catch (err) {
      console.error("Tool execution error:", err);
      if (err instanceof McpError) throw err;
      throw new McpError(ErrorCode.InternalError, err.message);
    }
  }

  async handleAddNumbers(args) {
    const { numbers } = args || {};
    if (!Array.isArray(numbers)) {
      throw new McpError(ErrorCode.InvalidParams, "Numbers must be an array");
    }
    if (numbers.length < 2) {
      throw new McpError(
        ErrorCode.InvalidParams,
        "At least 2 numbers are required"
      );
    }
    for (const n of numbers) {
      if (typeof n !== "number" || isNaN(n)) {
        throw new McpError(ErrorCode.InvalidParams, `Invalid number: ${n}`);
      }
    }
    const sum = numbers.reduce((a, b) => a + b, 0);
    return {
      content: [
        {
          type: "text",
          text: `Added ${numbers.length} numbers: ${numbers.join(
            " + "
          )} = ${sum}`,
        },
      ],
    };
  }

  async handleFetchJiraTicket(args) {
    const { ticketKey } = args || {};
    if (!ticketKey || typeof ticketKey !== "string") {
      throw new McpError(
        ErrorCode.InvalidParams,
        "Ticket key is required and must be a string"
      );
    }
    if (!/^[A-Z]+-[0-9]+$/.test(ticketKey)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        "Invalid ticket key format. Expected format: PROJ-123"
      );
    }

    const auth = Buffer.from(
      `${JIRA_CONFIG.email}:${JIRA_CONFIG.apiToken}`
    ).toString("base64");

    try {
      const res = await axios.get(
        `${JIRA_CONFIG.baseUrl}/rest/api/3/issue/${ticketKey}`,
        {
          headers: {
            Authorization: `Basic ${auth}`,
            Accept: "application/json",
            "Content-Type": "application/json",
          },
        }
      );

      const issue = res.data;
      const fields = issue.fields;
      const info = {
        key: issue.key,
        summary: fields.summary,
        status: fields.status.name,
        issueType: fields.issuetype.name,
        priority: fields.priority?.name || "Not set",
        assignee: fields.assignee?.displayName || "Unassigned",
        reporter: fields.reporter?.displayName || "Unknown",
        created: fields.created,
        updated: fields.updated,
        description: fields.description || "No description",
      };

      return {
        content: [
          {
            type: "text",
            text: `JIRA Ticket: ${info.key}
Title: ${info.summary}
Status: ${info.status}
Type: ${info.issueType}
Priority: ${info.priority}
Assignee: ${info.assignee}
Reporter: ${info.reporter}
Created: ${new Date(info.created).toLocaleDateString()}
Updated: ${new Date(info.updated).toLocaleDateString()}

Description: ${info.description}`,
          },
        ],
      };
    } catch (err) {
      console.error("JIRA API error:", err);
      if (err.response) {
        const code = err.response.status;
        const msg =
          err.response.data?.errorMessages?.[0] || err.response.statusText;
        if (code === 404) {
          throw new McpError(
            ErrorCode.InvalidParams,
            `JIRA ticket ${ticketKey} not found`
          );
        }
        throw new McpError(
          ErrorCode.InternalError,
          `JIRA API error (${code}): ${msg}`
        );
      }
      throw new McpError(ErrorCode.InternalError, err.message);
    }
  }

  async start() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("Local MCP Server running on stdio");
  }

  // HTTP JSON-RPC endpoint for web integrations
  async startHttp(port = 4000) {
    const app = express();

    // Basic CORS for localhost only
    app.use(
      cors({
        origin: ["http://localhost:8080", "http://127.0.0.1:8080"],
        credentials: true,
      })
    );
    app.use(express.json());

    // Health check endpoint
    app.get("/health", (req, res) => {
      res.json({ status: "ok", transport: "http", stdio: false });
    });

    // Main MCP JSON-RPC endpoint
    app.post("/mcp", async (req, res) => {
      const { method, params, id = Date.now() } = req.body || {};

      // Optional simple auth via header
      const authToken = process.env.MCP_HTTP_TOKEN;
      if (authToken && req.headers.authorization !== `Bearer ${authToken}`) {
        return res.status(401).json({
          jsonrpc: "2.0",
          error: { code: -32001, message: "Unauthorized" },
          id,
        });
      }

      try {
        let result;
        switch (method) {
          case "tools/list":
          case "listTools":
            result = await this.handleListTools();
            break;
          case "tools/call":
          case "callTool":
            result = await this.handleCall({ params });
            break;
          case "resources/list":
            result = await this.handleListResources();
            break;
          case "resources/read":
          case "readResource":
            result = await this.handleReadResource({ params });
            break;
          default:
            return res.status(400).json({
              jsonrpc: "2.0",
              error: { code: -32601, message: `Unknown method: ${method}` },
              id,
            });
        }

        res.json({
          jsonrpc: "2.0",
          result,
          id,
        });
      } catch (error) {
        console.error("HTTP MCP error:", error);
        const isMcpError = error instanceof McpError;
        res.status(isMcpError ? 400 : 500).json({
          jsonrpc: "2.0",
          error: {
            code: isMcpError ? error.code : -32603,
            message: error.message || "Internal error",
          },
          id,
        });
      }
    });

    return new Promise((resolve, reject) => {
      const server = app.listen(port, "127.0.0.1", () => {
        console.error(`MCP HTTP server running on http://127.0.0.1:${port}`);
        resolve(server);
      });
      server.on("error", reject);
    });
  }
}

// Launch - support both stdio and HTTP modes
const mcpServer = new LocalMCPServer();

// Always start stdio transport
mcpServer.start().catch(console.error);

// Optionally start HTTP if MCP_HTTP_PORT is set
const httpPort = process.env.MCP_HTTP_PORT;
if (httpPort) {
  mcpServer.startHttp(parseInt(httpPort, 10)).catch(console.error);
}
