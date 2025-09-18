# Hello World MCP Server

A production-ready Model Context Protocol (MCP) server that provides LLM-free data backbone services with robust JIRA integration and multi-transport support.

## Overview

This MCP server is designed as a **pure data backbone** for AI applications, providing structured data access without any LLM processing. It's perfect for Third Lane architectures where you want clean separation between data fetching (MCP) and AI processing (separate services).

## Features

### 🎯 Core Capabilities

- **JIRA Integration**: Comprehensive ticket fetching with dynamic field discovery
- **Dual Transport**: Both stdio and HTTP JSON-RPC endpoints
- **Perplexity Integration**: External AI service connectivity
- **Zero LLM Processing**: Pure data operations only

### 🔧 JIRA Features

- **Enhanced Ticket Fetching**: Single API call gets complete ticket data using `*all` fields
- **Dynamic Custom Field Discovery**: Automatically finds Story Points, Sprint, and Epic Link field IDs
- **Sprint Integration**: Full sprint data including active sprint, history, and goals
- **Epic Relationship Detection**: Supports both modern parent-based and legacy Epic Link approaches
- **Enhanced Time Tracking**: Pretty formatted strings, raw seconds, and aggregate times (with subtasks)
- **ADF Description Parsing**: Handles both Cloud (ADF) and Server (HTML) formats
- **Safe Property Access**: Null-safe field access prevents crashes
- **Comprehensive Error Handling**: Specific error messages for auth, permissions, not found
- **Lane B Compatibility**: Supports both `fetch_jira_ticket` and `fetch_ticket` tool names

### 🌐 Transport Options

- **Stdio Transport**: Standard MCP protocol for direct LLM integration
- **HTTP Transport**: JSON-RPC endpoint for web applications and external services
- **CORS Support**: Configured for localhost development

## Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   AI/LLM        │    │   MCP Server     │    │   JIRA API      │
│   (Lane C)      │◄──►│   (Lane B)       │◄──►│   (Data Source) │
│                 │    │                  │    │                 │
│ • Analysis      │    │ • Pure Data      │    │ • Tickets       │
│ • Insights      │    │ • No LLM         │    │ • Projects      │
│ • Recommendations │    │ • HTTP/stdio     │    │ • Users         │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

## Installation

```bash
# Clone the repository
git clone <repository-url>
cd hello-world-mcp

# Install dependencies
npm install

# Copy environment template
cp env.example .env

# Configure your JIRA credentials
nano .env
```

## Configuration

### Environment Variables

```bash
# JIRA Configuration
JIRA_BASE_URL=https://your-domain.atlassian.net
JIRA_EMAIL=your-email@domain.com
JIRA_API_TOKEN=your-api-token

# HTTP Transport (optional)
MCP_HTTP_PORT=4000
MCP_HTTP_TOKEN=optional-auth-token

# Perplexity Integration (optional)
PERPLEXITY_API_KEY=your-perplexity-key
```

### JIRA Setup

1. Go to [Atlassian Account Settings](https://id.atlassian.com/manage-profile/security/api-tokens)
2. Create an API token
3. Use your email and token in the environment variables

## Usage

### Start the Server

```bash
# Stdio transport only
node src/server.js

# With HTTP transport
MCP_HTTP_PORT=4000 node src/server.js

# Background with logging
npm run dev:logs
```

### Available Tools

#### 1. JIRA Ticket Fetching

```javascript
// Tool call
{
  "name": "fetch_ticket",
  "arguments": {
    "ticketKey": "PROJ-123"
  }
}
```

#### 2. Perplexity Search

```javascript
// Tool call
{
  "name": "fetch_perplexity_data",
  "arguments": {
    "query": "Latest AI developments",
    "model": "llama-3.1-sonar-small-128k-online"
  }
}
```

#### 3. Simple Math

```javascript
// Tool call
{
  "name": "add_numbers",
  "arguments": {
    "numbers": [1, 2, 3, 4, 5]
  }
}
```

### HTTP API Examples

```bash
# List available tools
curl -X POST http://localhost:4000/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/list",
    "id": 1
  }'

# Fetch JIRA ticket
curl -X POST http://localhost:4000/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "fetch_ticket",
      "arguments": {"ticketKey": "PROJ-123"}
    },
    "id": 2
  }'
```

## Testing

```bash
# Run basic tests
npm test

# Test JIRA integration specifically
TEST_TICKET_KEY=PROJ-123 node -e "
import('./src/jira-client.js').then(async m => {
  const result = await m.fetchJiraTicketFull({
    baseUrl: process.env.JIRA_BASE_URL,
    issueKey: process.env.TEST_TICKET_KEY,
    auth: { email: process.env.JIRA_EMAIL, apiToken: process.env.JIRA_API_TOKEN }
  });
  console.log('Success:', result.key, result.summary);
}).catch(console.error);
"
```

## JIRA Integration Details

### What the Enhanced Client Provides

- **Comprehensive Data**: Single API call fetches complete ticket information using `*all` fields
- **Advanced Agile Features**: Sprint data, Epic relationships, and Story Points
- **Dynamic Field Discovery**: Automatically finds custom fields across different JIRA instances
- **Sprint Management**: Active sprint detection, sprint history, goals, and dates
- **Epic Relationships**: Supports both modern parent concept and legacy Epic Link custom field
- **Enhanced Time Tracking**: Pretty strings, raw seconds, and aggregate times including subtasks
- **ADF Processing**: Converts Atlassian Document Format to readable plain text
- **Related Issues**: Normalized linked issues with direction indicators
- **Attachments & Comments**: Recent activity and file information
- **Parent/Subtask Relationships**: Complete hierarchy information

### Sample Enhanced JIRA Response

```
JIRA Ticket: SCRUM-8
═══════════════════════════════════════════════════════════════

BASIC INFORMATION:
• Title: Functions for calculating basic data
• Type: Story
• Status: To Do (To Do)
• Priority: Medium
• Project: My Scrum Project (SCRUM)

PEOPLE:
• Assignee: Veljko
• Reporter: mrdjan.stajic

TIMELINE:
• Created: 9/17/2025 10:30:45 AM
• Updated: 9/17/2025 12:15:22 PM

DESCRIPTION:
This story involves creating basic calculation functions...

ACTIVE SPRINT:
• Name: SCRUM Sprint 1
• State: active
• Start: 11/09/2025
• End: 09/10/2025
• Goal: Finish all the tasks

SPRINT HISTORY: 1 total (1 active)

EPIC: SCRUM-6 (via parent)

PARENT ISSUE:
• SCRUM-6: Hello world epic (To Do)

SUBTASKS:
• SCRUM-9: Implement addition function (To Do) - Unassigned
• SCRUM-10: Implement subtraction function (To Do) - Unassigned
...
```

## Pros and Cons

### ✅ Pros

**Architecture Benefits:**

- **Pure Data Backbone**: Zero LLM processing maintains clean separation of concerns
- **High Performance**: Direct API calls without AI overhead
- **Deterministic**: Predictable responses, no AI hallucinations
- **Cost Effective**: No LLM API costs for data fetching operations

**JIRA Integration:**

- **Robust Error Handling**: Specific error messages for different failure scenarios
- **Dynamic Field Discovery**: Works across different JIRA instances and configurations
- **Comprehensive Data**: Single API call gets complete ticket information
- **Format Agnostic**: Handles both Cloud (ADF) and Server (HTML) JIRA instances

**Technical:**

- **Dual Transport**: Supports both stdio and HTTP for maximum flexibility
- **Production Ready**: Comprehensive error handling and logging
- **Well Tested**: Proven with real JIRA data and edge cases
- **Easy Integration**: Standard MCP protocol compatibility

### ❌ Cons

**Limitations:**

- **No AI Features**: Cannot provide insights, analysis, or intelligent responses
- **JIRA Dependency**: Requires valid JIRA credentials and network access
- **Limited Scope**: Only provides data fetching, no business logic
- **Manual Configuration**: Requires environment setup for each deployment

**Operational:**

- **Network Dependencies**: Relies on external API availability
- **Authentication Management**: API tokens need periodic renewal
- **Single Point of Failure**: JIRA outages affect the entire data pipeline
- **Limited Caching**: No built-in caching for frequently accessed tickets

**Technical:**

- **No Real-time Updates**: Polling-based, not event-driven
- **Memory Usage**: Large tickets with many attachments can consume significant memory
- **Error Recovery**: Limited automatic retry mechanisms for transient failures

## Integration Examples

### Third Lane Architecture

```javascript
// Lane A: Intent Detection (separate service)
const intent = await detectIntent(userQuery);

// Lane B: Data Fetching (this MCP server)
const ticketData = await mcpCall("fetch_ticket", {
  ticketKey: intent.ticketKey,
});

// Lane C: AI Analysis (separate service)
const analysis = await analyzeData(ticketData, userQuery);
```

### Direct LLM Integration

```python
# Python MCP client example
import mcp

async def get_jira_data(ticket_key):
    async with mcp.stdio_client("node", "src/server.js") as client:
        result = await client.call_tool("fetch_ticket", {
            "ticketKey": ticket_key
        })
        return result.content[0].text
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Submit a pull request

## License

MIT License - see LICENSE file for details

## Support

For issues and questions:

- Check existing GitHub issues
- Review the troubleshooting section in this README
- Create a new issue with detailed information about your problem

---

**Note**: This MCP server is designed as a pure data backbone. For AI processing, analysis, or intelligent responses, integrate it with separate LLM services in a multi-lane architecture.

#TODO

- check when its apropriate to go into chat mode
- chek when it is apropriate to go into analyss mode
- it should be better to do the raw mcp query that returns raw data then feed that into one of the lances
- test it
- mora pre jer je vezano ako ne postoji prekini i kazi nema
- e2e tests
- add more features than for ticket (logic is there querymatcher and lanes needs to be aligned and example queries)
- investigate //TODO find lane b i think
- Random failuers to call final model (not that important since its gonna be provider anyhow)
