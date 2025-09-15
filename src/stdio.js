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

// Environment variables are provided by the parent process (HTTP bridge)
// to avoid stdout noise that corrupts JSON-RPC communication.
// For standalone STDIO mode, set MCP_STANDALONE=1 to load .env
if (process.env.MCP_STANDALONE === "1") {
  try {
    const { config } = await import("dotenv");
    config();
    console.error("[MCP] Loaded .env for standalone mode");
  } catch (e) {
    console.error("[MCP] Failed to load .env:", e.message);
  }
}

// Configuration
const JIRA_CONFIG = {
  // Basic Auth (fallback)
  baseUrl: process.env.JIRA_BASE_URL || "https://username.atlassian.net",
  email: process.env.JIRA_EMAIL,
  apiToken: process.env.JIRA_API_TOKEN,
  // OAuth 2.0 (preferred)
  oauthClientId: process.env.JIRA_OAUTH_CLIENT_ID || "",
  oauthClientSecret: process.env.JIRA_OAUTH_CLIENT_SECRET || "",
  oauthAudience: process.env.JIRA_OAUTH_AUDIENCE || "api.atlassian.com",
  cloudId: process.env.JIRA_CLOUD_ID || "",
  oauthEnabled:
    !!process.env.JIRA_OAUTH_CLIENT_ID &&
    !!process.env.JIRA_OAUTH_CLIENT_SECRET,
};

const PERPLEXITY_CONFIG = {
  apiKey: process.env.PERPLEXITY_API_KEY,
  baseUrl: process.env.PERPLEXITY_API_BASE || "https://api.perplexity.ai",
};

// Perplexity cache and search history
const perplexityCache = new Map();
const searchHistory = [];

class StdioMCPServer {
  constructor() {
    this.server = new Server(
      { name: "barebone-mcp", version: "1.0.0" },
      {
        capabilities: {
          tools: {},
          resources: {},
        },
      }
    );

    // OAuth token cache
    this.oauthToken = null;
    this.oauthExpires = 0;

    this.setupHandlers();
  }

  setupHandlers() {
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
    const tools = [
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
        name: "jira_whoami",
        description: "Get current JIRA user information",
        inputSchema: {
          type: "object",
          properties: {},
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
        name: "fetch_jira_projects",
        description: "List JIRA projects accessible to the user",
        inputSchema: {
          type: "object",
          properties: {
            maxResults: {
              type: "number",
              description: "Maximum number of projects to return",
              default: 50,
            },
          },
        },
      },
      {
        name: "fetch_current_sprint",
        description: "Fetch current sprint information for a project",
        inputSchema: {
          type: "object",
          properties: {
            projectKey: {
              type: "string",
              description: "JIRA project key (e.g., PROJ)",
            },
          },
          required: ["projectKey"],
        },
      },
    ];

    // Add Perplexity tool if API key is configured or MCP_ENABLE_PERPLEXITY is set
    const enablePerplexity =
      PERPLEXITY_CONFIG.apiKey || process.env.MCP_ENABLE_PERPLEXITY === "1";
    if (enablePerplexity) {
      tools.push({
        name: "fetch_perplexity_data",
        description: "Search for information using Perplexity AI",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Search query",
            },
            recency: {
              type: "string",
              enum: ["day", "week", "month", "year"],
              description: "Time filter for results",
            },
            domain: {
              type: "string",
              description: "Domain to focus search on",
            },
            return_citations: {
              type: "boolean",
              description: "Whether to return citations",
              default: true,
            },
            return_sources: {
              type: "boolean",
              description: "Whether to return sources",
              default: true,
            },
            max_results: {
              type: "number",
              description: "Maximum number of results",
            },
          },
          required: ["query"],
        },
      });
    }

    return { tools };
  }

  async handleListResources() {
    const resources = [];

    // Add search history resources if Perplexity is enabled
    const enablePerplexity =
      PERPLEXITY_CONFIG.apiKey || process.env.MCP_ENABLE_PERPLEXITY === "1";
    if (enablePerplexity) {
      resources.push(
        {
          uri: "search://history/",
          name: "Perplexity Search History",
          description: "Recent Perplexity search results",
        },
        {
          uri: "search://history/recent/5",
          name: "Recent 5 Searches",
          description: "Last 5 Perplexity searches",
        }
      );
    }

    return { resources };
  }

  async handleReadResource(request) {
    const { uri } = request.params || {};

    if (uri.startsWith("search://history/")) {
      return this.handleSearchHistoryResource(uri);
    }

    throw new McpError(ErrorCode.InvalidRequest, `Unknown resource: ${uri}`);
  }

  async handleSearchHistoryResource(uri) {
    const parts = uri
      .replace("search://history/", "")
      .split("/")
      .filter(Boolean);
    let filtered = searchHistory;

    if (parts.length === 0) {
      // Return all history
      filtered = searchHistory;
    } else if (parts[0] === "recent" && parts[1]) {
      const count = parseInt(parts[1]);
      filtered = searchHistory.slice(-count);
    } else if (parts[0] === "since" && parts[1]) {
      const since = parseInt(parts[1]);
      if (!isNaN(since)) {
        filtered = searchHistory.filter((h) => h.timestamp >= since);
      }
    } else if (parts[0] === "query" && parts[1]) {
      const searchTerm = decodeURIComponent(parts[1]).toLowerCase();
      filtered = searchHistory.filter((h) =>
        h.query.toLowerCase().includes(searchTerm)
      );
    } else if (parts[0] === "full" && parts[1]) {
      const searchId = parts[1];
      const search = searchHistory.find((h) => h.id === searchId);
      if (!search) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Search with ID ${searchId} not found`
        );
      }
      return {
        contents: [
          { type: "text", text: JSON.stringify(search.data, null, 2) },
        ],
      };
    }

    const contextData = {
      resource_type: "search_history",
      total_searches: searchHistory.length,
      filtered_count: filtered.length,
      searches: filtered.map((search) => ({
        id: search.id,
        timestamp: new Date(search.timestamp).toISOString(),
        query: search.query,
        summary: search.data.content.substring(0, 200) + "...",
        source_count: search.data.sources?.length || 0,
        domain_filter: search.params.domain || null,
        recency_filter: search.params.recency || "month",
      })),
      full_data_available:
        "Use search://history/full/{id} to get complete search data",
      usage_note:
        "This context helps understand previous searches and their relationships",
    };

    return {
      contents: [{ type: "text", text: JSON.stringify(contextData, null, 2) }],
    };
  }

  async handleCall(request) {
    const { name, arguments: args } = request.params || {};
    console.error(`[MCP] Tool called: ${name}`, args);

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
        case "jira_whoami":
          return this.handleJiraWhoami(args);
        case "fetch_jira_ticket":
          return this.handleFetchJiraTicket(args);
        case "fetch_jira_projects":
          return this.handleFetchJiraProjects(args);
        case "fetch_current_sprint":
          return this.handleFetchCurrentSprint(args);
        case "fetch_perplexity_data":
          return this.handleFetchPerplexityData(args);
        default:
          throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
      }
    } catch (err) {
      console.error(`[MCP] Tool execution error for ${name}:`, err.message);
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

  // OAuth 2.0 token management
  async getOAuthToken() {
    if (this.oauthToken && Date.now() < this.oauthExpires) {
      return this.oauthToken;
    }

    try {
      const response = await axios.post(
        "https://auth.atlassian.com/oauth/token",
        {
          grant_type: "client_credentials",
          client_id: JIRA_CONFIG.oauthClientId,
          client_secret: JIRA_CONFIG.oauthClientSecret,
          audience: JIRA_CONFIG.oauthAudience,
        },
        {
          headers: { "Content-Type": "application/json" },
        }
      );

      this.oauthToken = response.data.access_token;
      this.oauthExpires = Date.now() + response.data.expires_in * 1000 - 60000; // 1 min buffer
      console.error("[MCP] OAuth token acquired successfully");
      return this.oauthToken;
    } catch (error) {
      console.error(
        "[MCP] OAuth token acquisition failed:",
        error.response?.data || error.message
      );
      throw new McpError(
        ErrorCode.InternalError,
        "Failed to acquire OAuth token"
      );
    }
  }

  // Get JIRA client configuration
  async getJiraClient() {
    if (JIRA_CONFIG.oauthEnabled) {
      const token = await this.getOAuthToken();
      return {
        baseURL: `https://api.atlassian.com/ex/jira/${JIRA_CONFIG.cloudId}`,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
      };
    } else {
      // Fallback to Basic Auth
      const auth = Buffer.from(
        `${JIRA_CONFIG.email}:${JIRA_CONFIG.apiToken}`
      ).toString("base64");
      return {
        baseURL: JIRA_CONFIG.baseUrl,
        headers: {
          Authorization: `Basic ${auth}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
      };
    }
  }

  async handleJiraWhoami(args) {
    const client = await this.getJiraClient();

    try {
      const response = await axios.get(`${client.baseURL}/rest/api/3/myself`, {
        headers: client.headers,
      });

      const user = response.data;
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                accountId: user.accountId,
                displayName: user.displayName,
                emailAddress: user.emailAddress,
                active: user.active,
                timeZone: user.timeZone,
                locale: user.locale,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      console.error(
        "[MCP] JIRA whoami error:",
        error.response?.data || error.message
      );
      throw new McpError(
        ErrorCode.InternalError,
        `JIRA API error: ${error.response?.status || error.message}`
      );
    }
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

    const client = await this.getJiraClient();

    try {
      const response = await axios.get(
        `${client.baseURL}/rest/api/3/issue/${ticketKey}`,
        {
          headers: client.headers,
        }
      );

      const issue = response.data;
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
            text: JSON.stringify(info, null, 2),
          },
        ],
      };
    } catch (error) {
      console.error(
        "[MCP] JIRA ticket fetch error:",
        error.response?.data || error.message
      );
      if (error.response?.status === 404) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `JIRA ticket ${ticketKey} not found`
        );
      }
      throw new McpError(
        ErrorCode.InternalError,
        `JIRA API error: ${error.response?.status || error.message}`
      );
    }
  }

  async handleFetchJiraProjects(args) {
    const { maxResults = 50 } = args || {};
    const client = await this.getJiraClient();

    try {
      const response = await axios.get(
        `${client.baseURL}/rest/api/3/project/search`,
        {
          headers: client.headers,
          params: { maxResults },
        }
      );

      const projects = response.data.values.map((project) => ({
        key: project.key,
        name: project.name,
        projectTypeKey: project.projectTypeKey,
        style: project.style,
        lead: project.lead?.displayName || "Unknown",
      }));

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { projects, total: response.data.total },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      console.error(
        "[MCP] JIRA projects fetch error:",
        error.response?.data || error.message
      );
      throw new McpError(
        ErrorCode.InternalError,
        `JIRA API error: ${error.response?.status || error.message}`
      );
    }
  }

  async handleFetchCurrentSprint(args) {
    const { projectKey } = args || {};
    if (!projectKey) {
      throw new McpError(ErrorCode.InvalidParams, "Project key is required");
    }

    const client = await this.getJiraClient();

    try {
      // First, find boards for the project
      const boardsResponse = await axios.get(
        `${client.baseURL}/rest/agile/1.0/board`,
        {
          headers: client.headers,
          params: { projectKeyOrId: projectKey },
        }
      );

      if (!boardsResponse.data.values.length) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `No boards found for project ${projectKey}`
        );
      }

      const boardId = boardsResponse.data.values[0].id;

      // Get active sprints for the board
      const sprintsResponse = await axios.get(
        `${client.baseURL}/rest/agile/1.0/board/${boardId}/sprint`,
        {
          headers: client.headers,
          params: { state: "active" },
        }
      );

      const sprints = sprintsResponse.data.values.map((sprint) => ({
        id: sprint.id,
        name: sprint.name,
        state: sprint.state,
        startDate: sprint.startDate,
        endDate: sprint.endDate,
        goal: sprint.goal || "No goal set",
      }));

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ projectKey, boardId, sprints }, null, 2),
          },
        ],
      };
    } catch (error) {
      console.error(
        "[MCP] JIRA sprint fetch error:",
        error.response?.data || error.message
      );
      throw new McpError(
        ErrorCode.InternalError,
        `JIRA API error: ${error.response?.status || error.message}`
      );
    }
  }

  async handleFetchPerplexityData(args) {
    // Extract per-request auth and clean args
    const { _auth, ...cleanArgs } = args || {};
    const perplexityKey = _auth?.perplexityKey || PERPLEXITY_CONFIG.apiKey;

    if (!perplexityKey) {
      throw new McpError(
        ErrorCode.InternalError,
        "Perplexity API key not configured. Provide X-Perplexity-Key header or set PERPLEXITY_API_KEY environment variable."
      );
    }

    const {
      query,
      recency = "month",
      domain,
      return_citations = true,
      return_sources = true,
      max_results,
    } = cleanArgs;

    if (!query) {
      throw new McpError(ErrorCode.InvalidParams, "Query is required");
    }

    // Check cache
    const cacheKey = JSON.stringify({
      q: query.toLowerCase(),
      r: recency,
      d: domain,
    });

    if (perplexityCache.has(cacheKey)) {
      const cached = perplexityCache.get(cacheKey);
      const id = Date.now().toString(36);
      searchHistory.push({
        id,
        timestamp: Date.now(),
        query,
        params: args,
        data: cached,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { ...cached, cache_hit: true, search_id: id },
              null,
              2
            ),
          },
        ],
      };
    }

    // System prompt optimized for data collection
    const systemPrompt =
      "Return comprehensive, detailed search results with all relevant information and sources. " +
      "Do not summarize or analyze - provide complete data for further processing.";

    const body = {
      model: "sonar-pro",
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: domain
            ? `Search for: ${query}. Focus on domain: ${domain}`
            : query,
        },
      ],
      search_recency_filter: recency,
      return_citations,
      return_sources,
      max_tokens: max_results ? Math.min(max_results * 100, 4000) : 4000,
    };

    try {
      const response = await axios.post(
        `${PERPLEXITY_CONFIG.baseUrl}/chat/completions`,
        body,
        {
          headers: {
            Authorization: `Bearer ${perplexityKey}`,
            "Content-Type": "application/json",
          },
        }
      );

      const result = response.data;

      // Format data for local LLM consumption
      const formattedData = {
        search_metadata: {
          query,
          timestamp: new Date().toISOString(),
          recency_filter: recency,
          domain_filter: domain || null,
        },
        content: result.choices?.[0]?.message?.content || "",
        citations: result.citations || [],
        sources: result.sources || [],
        raw_response: result,
        instructions_for_local_llm:
          "Process this search data according to the user's needs. Analyze, summarize, compare, or answer questions based on this information.",
      };

      // Cache with TTL (1 hour)
      perplexityCache.set(cacheKey, formattedData);
      setTimeout(() => perplexityCache.delete(cacheKey), 3600000);

      // Add to search history
      const id = Date.now().toString(36);
      searchHistory.push({
        id,
        timestamp: Date.now(),
        query,
        params: args,
        data: formattedData,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { ...formattedData, cache_hit: false, search_id: id },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      console.error(
        "[MCP] Perplexity API error:",
        error.response?.data || error.message
      );
      throw new McpError(
        ErrorCode.InternalError,
        `Perplexity API error: ${error.response?.status || error.message}`
      );
    }
  }

  async start() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("[MCP] STDIO server running");
  }
}

// Start the STDIO MCP server
const mcpServer = new StdioMCPServer();
mcpServer.start().catch(console.error);
