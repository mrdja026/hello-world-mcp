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
import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import { PerplexityTool } from "./tools/perplexity.js";
import { fetchJiraTicketFull } from "./jira-client.js";
import {
  searchProjects,
  searchBoardsFull,
  searchProjectsWithBoards,
} from "./jira-project-board.js";
import { fetchProjectTree3Levels } from "./utils/jira-project-tree.js";

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
        {
          name: "search_jira_projects",
          description:
            "Search JIRA projects with optional filters (query, status, categoryId)",
          inputSchema: {
            type: "object",
            properties: {
              query: {
                type: "string",
                description: "Search term to match project names or keys",
              },
              status: {
                type: "string",
                enum: ["live", "archived", "deleted"],
                description: "Filter by project status",
              },
              categoryId: {
                type: "string",
                description: "Filter by project category ID",
              },
              maxResults: {
                type: "number",
                default: 50,
                minimum: 1,
                maximum: 100,
                description: "Maximum number of results to return",
              },
            },
          },
        },
        {
          name: "search_jira_boards",
          description:
            "Search JIRA boards with configuration, active sprints, and associated projects",
          inputSchema: {
            type: "object",
            properties: {
              name: {
                type: "string",
                description: "Board name to search for",
              },
              type: {
                type: "string",
                enum: ["scrum", "kanban"],
                description: "Board type filter",
              },
              projectKeyOrId: {
                type: "string",
                description:
                  "Filter boards by project key (e.g., 'PROJ') or ID",
              },
              maxResults: {
                type: "number",
                default: 50,
                minimum: 1,
                maximum: 100,
                description: "Maximum number of results to return",
              },
              includeConfig: {
                type: "boolean",
                default: true,
                description:
                  "Include board configuration (columns, estimation, etc.)",
              },
              includeActiveSprints: {
                type: "boolean",
                default: true,
                description: "Include active sprint information",
              },
              includeProjects: {
                type: "boolean",
                default: true,
                description: "Include projects associated with the board",
              },
            },
          },
        },
        {
          name: "search_projects_with_boards",
          description:
            "Combined search: find projects and their associated boards in one operation",
          inputSchema: {
            type: "object",
            properties: {
              projectQuery: {
                type: "string",
                description: "Search term for projects",
              },
              projectStatus: {
                type: "string",
                enum: ["live", "archived", "deleted"],
                description: "Filter projects by status",
              },
              projectCategoryId: {
                type: "string",
                description: "Filter projects by category ID",
              },
              boardType: {
                type: "string",
                enum: ["scrum", "kanban"],
                description: "Filter boards by type",
              },
              includeConfig: {
                type: "boolean",
                default: true,
                description: "Include board configurations",
              },
              includeActiveSprints: {
                type: "boolean",
                default: true,
                description: "Include active sprint information",
              },
            },
          },
        },
        {
          name: "fetch_jira_project_tree",
          description:
            "Fetch complete 3-level JIRA project tree: Project → Epics → Issues → Subtasks",
          inputSchema: {
            type: "object",
            properties: {
              projectKeyOrId: {
                type: "string",
                description: "Project key (e.g., 'WEB') or project ID",
              },
              pageSize: {
                type: "number",
                description: "Items per page (default: 100)",
                default: 100,
                minimum: 1,
                maximum: 500,
              },
            },
            required: ["projectKeyOrId"],
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
        case "search_jira_projects":
          return this.handleSearchJiraProjects(args);
        case "search_jira_boards":
          return this.handleSearchJiraBoards(args);
        case "search_projects_with_boards":
          return this.handleSearchProjectsWithBoards(args);
        case "fetch_jira_project_tree":
          return this.handleFetchJiraProjectTree(args);
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

    console.log(`Fetching JIRA ticket: ${ticketKey}`);

    try {
      // Use the enhanced JIRA client
      const ticketData = await fetchJiraTicketFull({
        baseUrl: JIRA_CONFIG.baseUrl,
        issueKey: ticketKey,
        auth: {
          email: JIRA_CONFIG.email,
          apiToken: JIRA_CONFIG.apiToken,
        },
      });

      console.log(`Successfully fetched JIRA ticket: ${ticketKey}`);

      // Format the comprehensive response using existing formatter
      const responseText = this.formatJiraTicketResponse(ticketData);

      return {
        content: [
          {
            type: "text",
            text: responseText,
          },
        ],
      };
    } catch (error) {
      console.error("Enhanced JIRA client error:", error.message);

      // Convert to MCP error format
      if (error.message.includes("not found")) {
        throw new McpError(ErrorCode.InvalidParams, error.message);
      } else if (
        error.message.includes("authentication") ||
        error.message.includes("access denied")
      ) {
        throw new McpError(ErrorCode.InvalidParams, error.message);
      } else {
        throw new McpError(ErrorCode.InternalError, error.message);
      }
    }
  }

  async handleSearchJiraProjects(args) {
    const { query, status, categoryId, maxResults = 50 } = args || {};

    console.log(
      `Searching JIRA projects with query: "${query}", status: ${status}`
    );

    try {
      const projects = await searchProjects({
        baseUrl: JIRA_CONFIG.baseUrl,
        auth: {
          email: JIRA_CONFIG.email,
          apiToken: JIRA_CONFIG.apiToken,
        },
        query,
        status,
        categoryId,
        maxResults,
      });

      console.log(`Found ${projects.length} projects`);

      const responseText = this.formatProjectsResponse(projects, {
        query,
        status,
        categoryId,
      });

      return {
        content: [
          {
            type: "text",
            text: responseText,
          },
        ],
      };
    } catch (error) {
      console.error("Project search error:", error.message);
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to search projects: ${error.message}`
      );
    }
  }

  async handleSearchJiraBoards(args) {
    const {
      name,
      type,
      projectKeyOrId,
      maxResults = 50,
      includeConfig = true,
      includeActiveSprints = true,
      includeProjects = true,
    } = args || {};

    console.log(
      `Searching JIRA boards with name: "${name}", type: ${type}, project: ${projectKeyOrId}`
    );

    try {
      const boards = await searchBoardsFull({
        baseUrl: JIRA_CONFIG.baseUrl,
        auth: {
          email: JIRA_CONFIG.email,
          apiToken: JIRA_CONFIG.apiToken,
        },
        name,
        type,
        projectKeyOrId,
        maxResults,
        includeConfig,
        includeActiveSprints,
        includeProjects,
      });

      console.log(`Found ${boards.length} boards`);

      const responseText = this.formatBoardsResponse(boards, {
        name,
        type,
        projectKeyOrId,
      });

      return {
        content: [
          {
            type: "text",
            text: responseText,
          },
        ],
      };
    } catch (error) {
      console.error("Board search error:", error.message);
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to search boards: ${error.message}`
      );
    }
  }

  async handleSearchProjectsWithBoards(args) {
    const {
      projectQuery,
      projectStatus,
      projectCategoryId,
      boardType,
      includeConfig = true,
      includeActiveSprints = true,
    } = args || {};

    console.log(
      `Searching projects with boards - project query: "${projectQuery}", board type: ${boardType}`
    );

    try {
      const projectsWithBoards = await searchProjectsWithBoards({
        baseUrl: JIRA_CONFIG.baseUrl,
        auth: {
          email: JIRA_CONFIG.email,
          apiToken: JIRA_CONFIG.apiToken,
        },
        projectQuery,
        projectStatus,
        projectCategoryId,
        boardType,
        includeConfig,
        includeActiveSprints,
      });

      console.log(`Found ${projectsWithBoards.length} projects with boards`);

      const responseText = this.formatProjectsWithBoardsResponse(
        projectsWithBoards,
        {
          projectQuery,
          projectStatus,
          boardType,
        }
      );

      return {
        content: [
          {
            type: "text",
            text: responseText,
          },
        ],
      };
    } catch (error) {
      console.error("Projects with boards search error:", error.message);
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to search projects with boards: ${error.message}`
      );
    }
  }

  async handleFetchJiraProjectTree(args) {
    const { projectKeyOrId, pageSize = 100 } = args || {};

    if (!projectKeyOrId || typeof projectKeyOrId !== "string") {
      throw new McpError(
        ErrorCode.InvalidParams,
        "Project key or ID is required and must be a string"
      );
    }

    console.log(`Fetching JIRA project tree for: ${projectKeyOrId}`);

    try {
      const projectTree = await fetchProjectTree3Levels({
        baseUrl: JIRA_CONFIG.baseUrl,
        auth: {
          email: JIRA_CONFIG.email,
          apiToken: JIRA_CONFIG.apiToken,
        },
        projectKeyOrId,
        pageSize,
      });

      console.log(`Successfully fetched project tree for: ${projectKeyOrId}`);
      console.log(
        `Stats: ${projectTree.stats.epics} epics, ${projectTree.stats.children} issues, ${projectTree.stats.subtasks} subtasks`
      );

      // Format the response for better readability
      const responseText = this.formatProjectTreeResponse(projectTree);

      return {
        content: [
          {
            type: "text",
            text: responseText,
          },
        ],
      };
    } catch (error) {
      console.error("Project tree fetch error:", error.message);
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to fetch project tree: ${error.message}`
      );
    }
  }

  formatProjectTreeResponse(projectTree) {
    let response = `JIRA Project Tree: ${projectTree.project}
═══════════════════════════════════════════════════════════════

PROJECT STATISTICS:
• Levels: ${projectTree.levels}
• Epics: ${projectTree.stats.epics}
• Issues: ${projectTree.stats.children}
• Subtasks: ${projectTree.stats.subtasks}

EPIC BREAKDOWN:
───────────────────────────────────────────────────────────────`;

    if (projectTree.epics.length === 0) {
      response += `\n\nNo epics found in project ${projectTree.project}.`;
      return response;
    }

    projectTree.epics.forEach((epic, index) => {
      const childCount = epic.children?.length || 0;
      const subtaskCount =
        epic.children?.reduce(
          (sum, child) => sum + (child.subtasks?.length || 0),
          0
        ) || 0;

      response += `\n\n${index + 1}. EPIC: ${epic.key} - ${epic.summary}
   • Status: ${epic.status || "Unknown"}
   • Priority: ${epic.priority || "Normal"}
   • Assignee: ${epic.assignee || "Unassigned"}`;

      if (epic.storyPoints) {
        response += `\n   • Story Points: ${epic.storyPoints}`;
      }

      response += `\n   • Child Issues: ${childCount}
   • Subtasks: ${subtaskCount}`;

      if (epic.children && epic.children.length > 0) {
        response += `\n\n   CHILD ISSUES:`;
        epic.children.forEach((child, childIndex) => {
          response += `\n   ${childIndex + 1}. ${child.key} - ${child.summary}
      • Type: ${child.issuetype || "Unknown"}
      • Status: ${child.status || "Unknown"}
      • Assignee: ${child.assignee || "Unassigned"}`;

          if (child.storyPoints) {
            response += `\n      • Story Points: ${child.storyPoints}`;
          }

          if (child.subtasks && child.subtasks.length > 0) {
            response += `\n      • Subtasks: ${child.subtasks.length}`;
            child.subtasks.forEach((subtask, subtaskIndex) => {
              response += `\n        ${subtaskIndex + 1}. ${subtask.key} - ${
                subtask.summary
              } (${subtask.status || "Unknown"})`;
            });
          }
        });
      }
    });

    return response;
  }

  formatProjectsResponse(projects, searchParams) {
    let response = `JIRA Projects Search Results
═══════════════════════════════════════════════════════════════

SEARCH PARAMETERS:`;
    if (searchParams.query) response += `\n• Query: "${searchParams.query}"`;
    if (searchParams.status) response += `\n• Status: ${searchParams.status}`;
    if (searchParams.categoryId)
      response += `\n• Category ID: ${searchParams.categoryId}`;

    response += `\n\nFOUND ${projects.length} PROJECTS:
───────────────────────────────────────────────────────────────`;

    projects.forEach((project, index) => {
      response += `\n\n${index + 1}. ${project.name} (${project.key})
   • ID: ${project.id}
   • Type: ${project.projectTypeKey || "Unknown"}
   • Style: ${project.style || "Unknown"}`;

      if (project.simplified !== null) {
        response += `\n   • Simplified: ${project.simplified}`;
      }

      if (project.category) {
        response += `\n   • Category: ${project.category.name} (${project.category.id})`;
      }

      response += `\n   • Avatar: ${
        Object.keys(project.avatarUrls).length > 0 ? "Available" : "None"
      }`;
    });

    return response;
  }

  formatBoardsResponse(boards, searchParams) {
    let response = `JIRA Boards Search Results
═══════════════════════════════════════════════════════════════

SEARCH PARAMETERS:`;
    if (searchParams.name) response += `\n• Name: "${searchParams.name}"`;
    if (searchParams.type) response += `\n• Type: ${searchParams.type}`;
    if (searchParams.projectKeyOrId)
      response += `\n• Project: ${searchParams.projectKeyOrId}`;

    response += `\n\nFOUND ${boards.length} BOARDS:
───────────────────────────────────────────────────────────────`;

    boards.forEach((board, index) => {
      response += `\n\n${index + 1}. ${board.name} (ID: ${board.id})
   • Type: ${board.type}`;

      if (board.location) {
        response += `\n   • Location: ${board.location.name} (${board.location.projectKey})`;
      }

      if (board.config) {
        response += `\n   • Configuration:
     - Filter ID: ${board.config.filterId}
     - Columns: ${board.config.columns.length}`;

        if (board.config.estimation) {
          response += `\n     - Estimation Field: ${board.config.estimation.displayName}`;
        }

        if (board.config.rankingFieldId) {
          response += `\n     - Ranking Field: ${board.config.rankingFieldId}`;
        }
      }

      if (board.activeSprints && board.activeSprints.length > 0) {
        response += `\n   • Active Sprints: ${board.activeSprints.length}`;
        board.activeSprints.forEach((sprint) => {
          response += `\n     - ${sprint.name} (${sprint.id})`;
          if (sprint.goal) response += `\n       Goal: ${sprint.goal}`;
          if (sprint.startDate && sprint.endDate) {
            response += `\n       Duration: ${new Date(
              sprint.startDate
            ).toLocaleDateString()} - ${new Date(
              sprint.endDate
            ).toLocaleDateString()}`;
          }
        });
      }

      if (board.projects && board.projects.length > 0) {
        response += `\n   • Associated Projects: ${board.projects.length}`;
        board.projects.forEach((project) => {
          response += `\n     - ${project.name} (${project.key})`;
        });
      }
    });

    return response;
  }

  formatProjectsWithBoardsResponse(projectsWithBoards, searchParams) {
    let response = `JIRA Projects with Boards Search Results
═══════════════════════════════════════════════════════════════

SEARCH PARAMETERS:`;
    if (searchParams.projectQuery)
      response += `\n• Project Query: "${searchParams.projectQuery}"`;
    if (searchParams.projectStatus)
      response += `\n• Project Status: ${searchParams.projectStatus}`;
    if (searchParams.boardType)
      response += `\n• Board Type: ${searchParams.boardType}`;

    response += `\n\nFOUND ${projectsWithBoards.length} PROJECTS WITH BOARDS:
───────────────────────────────────────────────────────────────`;

    projectsWithBoards.forEach((item, index) => {
      const { project, boards } = item;
      response += `\n\n${index + 1}. PROJECT: ${project.name} (${project.key})
   • ID: ${project.id}
   • Type: ${project.projectTypeKey || "Unknown"}`;

      if (project.category) {
        response += `\n   • Category: ${project.category.name}`;
      }

      response += `\n   • Boards: ${boards.length}`;

      boards.forEach((board, boardIndex) => {
        response += `\n\n     ${boardIndex + 1}. ${board.name} (${board.type})`;

        if (board.activeSprints && board.activeSprints.length > 0) {
          response += `\n        • Active Sprints: ${board.activeSprints
            .map((s) => s.name)
            .join(", ")}`;
        }

        if (board.config && board.config.columns) {
          response += `\n        • Columns: ${board.config.columns.length} configured`;
        }
      });
    });

    return response;
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

    // Enhanced time tracking
    if (
      info.timeTracking &&
      (info.timeTracking.originalEstimate ||
        info.timeTracking.timeSpent ||
        info.timeTracking.remainingEstimate)
    ) {
      response += `\n\nTIME TRACKING:`;

      // Pretty formatted times
      if (info.timeTracking.originalEstimate)
        response += `\n• Original Estimate: ${info.timeTracking.originalEstimate}`;
      if (info.timeTracking.remainingEstimate)
        response += `\n• Remaining: ${info.timeTracking.remainingEstimate}`;
      if (info.timeTracking.timeSpent)
        response += `\n• Time Spent: ${info.timeTracking.timeSpent}`;

      // Raw seconds for precise calculations
      const hasRawTimes =
        info.timeTracking.originalEstimateSeconds ||
        info.timeTracking.remainingEstimateSeconds ||
        info.timeTracking.timeSpentSeconds;
      if (hasRawTimes) {
        response += `\n• Raw Seconds: `;
        if (info.timeTracking.originalEstimateSeconds)
          response += `Estimate=${info.timeTracking.originalEstimateSeconds}s `;
        if (info.timeTracking.timeSpentSeconds)
          response += `Spent=${info.timeTracking.timeSpentSeconds}s `;
        if (info.timeTracking.remainingEstimateSeconds)
          response += `Remaining=${info.timeTracking.remainingEstimateSeconds}s`;
      }

      // Aggregate times (includes subtasks)
      const hasAggregate =
        info.timeTracking.aggregate?.originalEstimateSeconds ||
        info.timeTracking.aggregate?.timeSpentSeconds ||
        info.timeTracking.aggregate?.remainingEstimateSeconds;
      if (hasAggregate) {
        response += `\n• With Subtasks: `;
        if (info.timeTracking.aggregate.originalEstimateSeconds)
          response += `Estimate=${info.timeTracking.aggregate.originalEstimateSeconds}s `;
        if (info.timeTracking.aggregate.timeSpentSeconds)
          response += `Spent=${info.timeTracking.aggregate.timeSpentSeconds}s `;
        if (info.timeTracking.aggregate.remainingEstimateSeconds)
          response += `Remaining=${info.timeTracking.aggregate.remainingEstimateSeconds}s`;
      }
    }

    // Agile information
    if (info.storyPoints) {
      response += `\n\nSTORY POINTS: ${info.storyPoints}`;
    }

    // Sprint information
    if (info.activeSprint) {
      response += `\n\nACTIVE SPRINT:
• Name: ${info.activeSprint.name}
• State: ${info.activeSprint.state}`;
      if (info.activeSprint.startDate) {
        response += `\n• Start: ${new Date(
          info.activeSprint.startDate
        ).toLocaleDateString()}`;
      }
      if (info.activeSprint.endDate) {
        response += `\n• End: ${new Date(
          info.activeSprint.endDate
        ).toLocaleDateString()}`;
      }
      if (info.activeSprint.goal) {
        response += `\n• Goal: ${info.activeSprint.goal}`;
      }
    }

    // All sprints summary
    if (info.sprints && info.sprints.length > 0) {
      const sprintCounts = info.sprints.reduce((acc, sprint) => {
        acc[sprint.state] = (acc[sprint.state] || 0) + 1;
        return acc;
      }, {});
      const sprintSummary = Object.entries(sprintCounts)
        .map(([state, count]) => `${count} ${state}`)
        .join(", ");
      response += `\n\nSPRINT HISTORY: ${info.sprints.length} total (${sprintSummary})`;
    }

    // Epic information
    if (info.epic) {
      response += `\n\nEPIC: ${info.epic.key} (via ${info.epic.source})`;
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
            result = await this.handleReadResource({ params: params });
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
