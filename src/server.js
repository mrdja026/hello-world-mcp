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

// Load environment variables
dotenv.config();

// Configuration from environment variables
const JIRA_CONFIG = {
  baseUrl: "https://username.atlassian.net" || process.env.JIRA_BASE_URL,
  email: process.env.JIRA_EMAIL || process.env.JIRA_EMAIL,
  apiToken: process.env.JIRA_API_TOKEN,
};

class LocalMCPServer {
  constructor() {
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
    const { name, arguments: args } = request.params || {};
    console.error("Tool called:", name, args);

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
}

// Launch
new LocalMCPServer().start().catch(console.error);
