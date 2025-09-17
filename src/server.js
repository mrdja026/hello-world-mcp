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
        {
          name: "fetch_ticket",
          description:
            "Fetch a JIRA ticket by its key (Lane B enhanced compatibility)",
          inputSchema: {
            type: "object",
            properties: {
              ticketKey: {
                type: "string",
                description: "JIRA ticket key (e.g., SCRUM-42)",
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
    console.error("handleCall received:", JSON.stringify(request, null, 2));
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
        case "fetch_ticket": // Lane B compatibility alias
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
      // Enhanced API call with expand parameter for comprehensive data
      const res = await axios.get(
        `${JIRA_CONFIG.baseUrl}/rest/api/2/issue/${ticketKey}`,
        {
          headers: {
            Authorization: `Basic ${auth}`,
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          params: {
            // Get comprehensive data
            expand:
              "renderedFields,names,schema,transitions,operations,editmeta,changelog,versionedRepresentations",
          },
        }
      );

      const issue = res.data;
      const fields = issue.fields;

      console.error("API Response structure:", {
        hasIssue: !!issue,
        hasFields: !!fields,
        hasStatus: !!fields?.status,
        hasIssueType: !!fields?.issuetype,
        fieldKeys: fields ? Object.keys(fields).slice(0, 10) : "no fields",
      });

      // Extract comprehensive issue information
      const info = {
        // Basic fields
        key: issue.key,
        id: issue.id,
        self: issue.self,
        summary: fields.summary,
        description: fields.description || "No description",

        // Status and workflow
        status: {
          name: fields.status?.name || "Unknown",
          id: fields.status?.id || "unknown",
          statusCategory: fields.status?.statusCategory?.name || "Unknown",
          description: fields.status?.description || "",
        },

        // Issue classification
        issueType: {
          name: fields.issuetype.name,
          id: fields.issuetype.id,
          description: fields.issuetype.description || "",
          iconUrl: fields.issuetype.iconUrl,
        },

        // Priority
        priority: fields.priority
          ? {
              name: fields.priority.name,
              id: fields.priority.id,
              iconUrl: fields.priority.iconUrl,
            }
          : { name: "Not set", id: null, iconUrl: null },

        // People
        assignee: fields.assignee
          ? {
              displayName: fields.assignee.displayName,
              accountId: fields.assignee.accountId,
              emailAddress: fields.assignee.emailAddress || "Hidden",
              avatarUrls: fields.assignee.avatarUrls,
            }
          : { displayName: "Unassigned", accountId: null },

        reporter: fields.reporter
          ? {
              displayName: fields.reporter.displayName,
              accountId: fields.reporter.accountId,
              emailAddress: fields.reporter.emailAddress || "Hidden",
              avatarUrls: fields.reporter.avatarUrls,
            }
          : { displayName: "Unknown", accountId: null },

        // Dates
        created: fields.created,
        updated: fields.updated,
        duedate: fields.duedate || null,
        resolutiondate: fields.resolutiondate || null,

        // Project information
        project: {
          key: fields.project.key,
          name: fields.project.name,
          id: fields.project.id,
          projectTypeKey: fields.project.projectTypeKey,
        },

        // Resolution
        resolution: fields.resolution
          ? {
              name: fields.resolution.name,
              description: fields.resolution.description,
            }
          : null,

        // Components and versions
        components:
          fields.components?.map((comp) => ({
            name: comp.name,
            id: comp.id,
            description: comp.description || "",
          })) || [],

        fixVersions:
          fields.fixVersions?.map((version) => ({
            name: version.name,
            id: version.id,
            description: version.description || "",
            released: version.released,
            releaseDate: version.releaseDate,
          })) || [],

        affectedVersions:
          fields.versions?.map((version) => ({
            name: version.name,
            id: version.id,
            description: version.description || "",
            released: version.released,
            releaseDate: version.releaseDate,
          })) || [],

        // Labels
        labels: fields.labels || [],

        // Environment
        environment: fields.environment || null,

        // Story points and estimation (common field names)
        storyPoints: fields.customfield_10016 || fields.storypoints || null,
        timeTracking: fields.timetracking
          ? {
              originalEstimate: fields.timetracking.originalEstimate,
              remainingEstimate: fields.timetracking.remainingEstimate,
              timeSpent: fields.timetracking.timeSpent,
              originalEstimateSeconds:
                fields.timetracking.originalEstimateSeconds,
              remainingEstimateSeconds:
                fields.timetracking.remainingEstimateSeconds,
              timeSpentSeconds: fields.timetracking.timeSpentSeconds,
            }
          : null,

        // Security level
        security: fields.security
          ? {
              name: fields.security.name,
              description: fields.security.description,
            }
          : null,

        // Linked issues (if expanded)
        linkedIssues:
          issue.fields.issuelinks?.map((link) => ({
            id: link.id,
            type: {
              name: link.type.name,
              inward: link.type.inward,
              outward: link.type.outward,
            },
            inwardIssue: link.inwardIssue
              ? {
                  key: link.inwardIssue.key,
                  summary: link.inwardIssue.fields.summary,
                  status: link.inwardIssue.fields.status.name,
                  priority: link.inwardIssue.fields.priority?.name || "Not set",
                }
              : null,
            outwardIssue: link.outwardIssue
              ? {
                  key: link.outwardIssue.key,
                  summary: link.outwardIssue.fields.summary,
                  status: link.outwardIssue.fields.status.name,
                  priority:
                    link.outwardIssue.fields.priority?.name || "Not set",
                }
              : null,
          })) || [],

        // Attachments count
        attachmentsCount: fields.attachment?.length || 0,
        attachments:
          fields.attachment
            ?.map((att) => ({
              id: att.id,
              filename: att.filename,
              size: att.size,
              mimeType: att.mimeType,
              created: att.created,
              author: att.author.displayName,
            }))
            .slice(0, 5) || [], // Limit to first 5 attachments

        // Comments count
        commentsCount: fields.comment?.total || 0,
        recentComments:
          fields.comment?.comments
            ?.map((comment) => ({
              id: comment.id,
              author: comment.author.displayName,
              body: comment.body,
              created: comment.created,
              updated: comment.updated,
            }))
            .slice(-3) || [], // Last 3 comments

        // Watchers and votes
        watchersCount: fields.watches?.watchCount || 0,
        votesCount: fields.votes?.votes || 0,

        // Progress
        progress: fields.progress
          ? {
              progress: fields.progress.progress,
              total: fields.progress.total,
              percent: fields.progress.percent,
            }
          : null,

        // Parent issue (for subtasks)
        parent: fields.parent
          ? {
              key: fields.parent.key,
              summary: fields.parent.fields.summary,
              status: fields.parent.fields.status.name,
            }
          : null,

        // Subtasks
        subtasks:
          fields.subtasks?.map((subtask) => ({
            key: subtask.key,
            summary: subtask.fields.summary,
            status: subtask.fields.status.name,
            assignee: subtask.fields.assignee?.displayName || "Unassigned",
          })) || [],
      };

      // Format comprehensive response
      const responseText = this.formatJiraTicketResponse(info);

      return {
        content: [
          {
            type: "text",
            text: responseText,
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

  formatJiraTicketResponse(info) {
    let response = `JIRA Ticket: ${info.key}
═══════════════════════════════════════════════════════════════

BASIC INFORMATION:
• Title: ${info.summary}
• Type: ${info.issueType.name}
• Status: ${info.status.name} (${info.status.statusCategory})
• Priority: ${info.priority.name}
• Project: ${info.project.name} (${info.project.key})

PEOPLE:
• Assignee: ${info.assignee.displayName}
• Reporter: ${info.reporter.displayName}

TIMELINE:
• Created: ${new Date(info.created).toLocaleDateString()} ${new Date(
      info.created
    ).toLocaleTimeString()}
• Updated: ${new Date(info.updated).toLocaleDateString()} ${new Date(
      info.updated
    ).toLocaleTimeString()}`;

    if (info.duedate) {
      response += `\n• Due Date: ${new Date(
        info.duedate
      ).toLocaleDateString()}`;
    }
    if (info.resolutiondate) {
      response += `\n• Resolved: ${new Date(
        info.resolutiondate
      ).toLocaleDateString()}`;
    }

    response += `\n\nDESCRIPTION:
${info.description}`;

    if (info.resolution) {
      response += `\n\nRESOLUTION:
• Status: ${info.resolution.name}
• Details: ${info.resolution.description}`;
    }

    if (info.components.length > 0) {
      response += `\n\nCOMPONENTS:
${info.components
  .map((comp) => `• ${comp.name}: ${comp.description}`)
  .join("\n")}`;
    }

    if (info.fixVersions.length > 0) {
      response += `\n\nFIX VERSIONS:
${info.fixVersions
  .map((ver) => `• ${ver.name} (Released: ${ver.released ? "Yes" : "No"})`)
  .join("\n")}`;
    }

    if (info.labels.length > 0) {
      response += `\n\nLABELS:
${info.labels.join(", ")}`;
    }

    if (info.linkedIssues.length > 0) {
      response += `\n\nLINKED ISSUES:`;
      info.linkedIssues.forEach((link) => {
        if (link.inwardIssue) {
          response += `\n• ${link.type.inward}: ${link.inwardIssue.key} - ${link.inwardIssue.summary} (${link.inwardIssue.status})`;
        }
        if (link.outwardIssue) {
          response += `\n• ${link.type.outward}: ${link.outwardIssue.key} - ${link.outwardIssue.summary} (${link.outwardIssue.status})`;
        }
      });
    }

    if (info.parent) {
      response += `\n\nPARENT ISSUE:
• ${info.parent.key}: ${info.parent.summary} (${info.parent.status})`;
    }

    if (info.subtasks.length > 0) {
      response += `\n\nSUBTASKS:`;
      info.subtasks.forEach((subtask) => {
        response += `\n• ${subtask.key}: ${subtask.summary} (${subtask.status}) - ${subtask.assignee}`;
      });
    }

    if (info.timeTracking) {
      response += `\n\nTIME TRACKING:`;
      if (info.timeTracking.originalEstimate)
        response += `\n• Original Estimate: ${info.timeTracking.originalEstimate}`;
      if (info.timeTracking.remainingEstimate)
        response += `\n• Remaining: ${info.timeTracking.remainingEstimate}`;
      if (info.timeTracking.timeSpent)
        response += `\n• Time Spent: ${info.timeTracking.timeSpent}`;
    }

    if (info.storyPoints) {
      response += `\n\nSTORY POINTS: ${info.storyPoints}`;
    }

    response += `\n\nACTIVITY:
• Comments: ${info.commentsCount}
• Attachments: ${info.attachmentsCount}
• Watchers: ${info.watchersCount}
• Votes: ${info.votesCount}`;

    if (info.recentComments.length > 0) {
      response += `\n\nRECENT COMMENTS:`;
      info.recentComments.forEach((comment) => {
        response += `\n• ${comment.author} (${new Date(
          comment.created
        ).toLocaleDateString()}): ${comment.body.substring(0, 100)}${
          comment.body.length > 100 ? "..." : ""
        }`;
      });
    }

    return response;
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
            result = await this.handleCall({ params: params });
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
