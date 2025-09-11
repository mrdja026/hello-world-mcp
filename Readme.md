# JIRA MCP Server

## Overview

MVP implementation of a Model Context Protocol (MCP) server that integrates with JIRA. Provides tools for fetching JIRA ticket information and basic arithmetic operations.

## Tech Stack

- **Node.js** (v18+)
- **MCP SDK** (@modelcontextprotocol/sdk)
- **Axios** for HTTP requests
- **dotenv** for environment variables
- **JIRA REST API v3**

## Features

- `add_numbers`: Add multiple numbers together
- `fetch_jira_ticket`: Fetch JIRA ticket details by key (e.g., SCRUM-7)

## Installation

1. **Clone and install dependencies:**

   ```bash
   npm install
   ```

2. **Create `.env` file:**

   ```
   JIRA_EMAIL=your-email@domain.com
   JIRA_API_TOKEN=your_jira_api_token
   ```

3. **Get JIRA API Token:**
   - Go to https://id.atlassian.com/manage-profile/security/api-tokens
   - Create API token
   - Add to `.env` file

## Usage with AnythingLLM + Context7

1. **Start the MCP server:**

   ```bash
   npm start
   ```

2. **Configure in AnythingLLM:**

   - Add MCP server endpoint
   - Server runs on stdio transport
   - Base URL: `https://username.atlassian.net`

3. **Example prompts:**
   ```
   Fetch JIRA ticket SCRUM-7 using the fetch_jira_ticket tool
   ```
   ```
   Add these numbers: [10, 20, 30] using the add_numbers tool
   ```

## JIRA Configuration

- Configured for:
- Supports ticket pattern: `[A-Z]+-[0-9]+`
- Returns: title, status, assignee, description, dates

## Development

```bash
npm run dev  # Watch mode
```
