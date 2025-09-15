# Barebone MCP Server

## Overview

A production-ready Model Context Protocol (MCP) server with STDIO-first architecture and HTTP bridge. Implements Jira integration, Perplexity AI search, and utility tools for LLM workflows.

## Tech Stack

- **Node.js** (v18+)
- **MCP SDK** (@modelcontextprotocol/sdk)
- **Axios** for HTTP requests
- **dotenv** for environment variables
- **JIRA REST API v3**
- **Perplexity AI API**

## Architecture

```
STDIO MCP Core (src/stdio.js)
    ↑
HTTP Bridge (src/http-bridge.js)
    ↑
External Clients (clone-gpt, etc.)
```

- **STDIO Core**: Pure MCP server implementation using `@modelcontextprotocol/sdk`
- **HTTP Bridge**: Spawns STDIO process and exposes JSON-RPC over HTTP
- **Dual Transport**: Supports both STDIO (for editors) and HTTP (for web apps)

## Tools

### Core Tools

- `add_numbers`: Add multiple numbers together (demo tool)

### Jira Tools

- `jira_whoami`: Get current Jira user information
- `fetch_jira_ticket`: Fetch Jira ticket by key (e.g., PROJ-123)
- `fetch_jira_projects`: List accessible Jira projects
- `fetch_current_sprint`: Get current sprint for a project

### Perplexity Tools

- `fetch_perplexity_data`: Search using Perplexity AI with caching and history

## Resources

### Search History

- `search://history/`: All Perplexity search results
- `search://history/recent/N`: Last N searches
- `search://history/since/TIMESTAMP`: Searches since timestamp
- `search://history/query/TERM`: Searches containing term
- `search://history/full/ID`: Full search data by ID

## Installation

```bash
npm install
```

## Configuration

Create `.env` file (see `env.example`):

### Jira - Basic Auth (fallback)

```bash
JIRA_BASE_URL=https://your-instance.atlassian.net
JIRA_EMAIL=your-email@domain.com
JIRA_API_TOKEN=your_jira_api_token
```

### Jira - OAuth 2.0 (preferred)

```bash
JIRA_OAUTH_CLIENT_ID=your_oauth_client_id
JIRA_OAUTH_CLIENT_SECRET=your_oauth_client_secret
JIRA_OAUTH_AUDIENCE=api.atlassian.com
JIRA_CLOUD_ID=your_cloud_id_uuid
```

### Perplexity

```bash
PERPLEXITY_API_KEY=pplx-your-key-here
PERPLEXITY_API_BASE=https://api.perplexity.ai
```

### HTTP Bridge

```bash
MCP_HTTP_PORT=4000
MCP_HTTP_TOKEN=optional_bearer_token
```

## Usage

### Quick Start for Production Teams

1. **Install dependencies:**

   ```bash
   npm install
   ```

2. **Configure environment (copy `env.example` to `.env`):**

   ```bash
   cp env.example .env
   # Edit .env with your Jira/Perplexity credentials
   ```

3. **Start the MCP server:**

   ```bash
   npm run http
   ```

4. **Verify it's working:**
   ```bash
   # Run comprehensive test suite
   ./test-mcp-server.ps1
   # or
   ./test-mcp-server.sh
   ```

### STDIO Mode (Primary)

For MCP-aware editors and direct integration:

```bash
# Start STDIO server (for standalone use)
MCP_STANDALONE=1 npm run stdio

# Or with watch mode
MCP_STANDALONE=1 npm run dev:stdio
```

Configure MCP clients to spawn: `node src/stdio.js`

### HTTP Bridge Mode (Recommended for Teams)

For web applications and HTTP clients:

```bash
# Start HTTP bridge (spawns STDIO child automatically)
npm run http

# Or with watch mode
npm run dev:http
```

The bridge runs on `http://127.0.0.1:4000` by default and provides:

- **JSON-RPC 2.0 compliance**
- **Automatic MCP initialization**
- **Method name normalization** (`listTools` → `tools/list`)
- **Health monitoring** (`/health` endpoint)
- **Auto-restart** on child process failure

## API Examples

### List Tools

```bash
curl -X POST http://127.0.0.1:4000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"listTools","id":1}'
```

### Call Jira Tool

```bash
curl -X POST http://127.0.0.1:4000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"callTool","params":{"name":"jira_whoami","arguments":{}},"id":2}'
```

### Fetch Jira Ticket

```bash
curl -X POST http://127.0.0.1:4000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"callTool","params":{"name":"fetch_jira_ticket","arguments":{"ticketKey":"PROJ-123"}},"id":3}'
```

### Perplexity Search

```bash
curl -X POST http://127.0.0.1:4000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"callTool","params":{"name":"fetch_perplexity_data","arguments":{"query":"Latest in local LLM optimization","recency":"week"}},"id":4}'
```

### Read Search History

```bash
curl -X POST http://127.0.0.1:4000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"readResource","params":{"uri":"search://history/recent/5"},"id":5}'
```

## Integration with clone-gpt

Configure `clone-gpt/.env`:

```bash
MCP_FORWARD_ONLY=1
MCP_BASE_URL=http://127.0.0.1:4000
```

Start sequence:

1. Start this MCP server: `npm run http`
2. Start clone-gpt: `pnpm dev`
3. Test via clone-gpt API: `http://localhost:8080/api/mcp/tools`

## Security

### HTTP Bridge Security

- **Localhost binding**: Only `127.0.0.1` by default
- **Bearer auth**: Optional via `MCP_HTTP_TOKEN`
- **CORS**: Restricted to localhost origins
- **Process isolation**: STDIO child runs in separate process

### Jira Authentication

- **OAuth 2.0**: Preferred method with proper scopes
- **Basic Auth**: Fallback for development
- **Token management**: Automatic refresh with 1-minute buffer

### Perplexity

- **API key**: Stored in environment, not exposed
- **Rate limiting**: Cached responses with TTL
- **Data isolation**: Search history stored in memory only

## Error Handling

### HTTP Bridge

- Auto-restart STDIO child on crash (max 5 attempts)
- Exponential backoff on restart failures
- Request timeout (60 seconds)
- Graceful error responses in JSON-RPC format

### Jira Integration

- OAuth token refresh on expiration
- Fallback to Basic Auth if OAuth fails
- Detailed error messages with HTTP status codes
- Input validation for ticket keys and parameters

## Development

```bash
# STDIO development
npm run dev:stdio

# HTTP bridge development
npm run dev:http

# Legacy combined mode
npm run dev
```

## Scripts

- `npm run stdio`: Start STDIO server
- `npm run dev:stdio`: STDIO server with watch mode
- `npm run http`: Start HTTP bridge
- `npm run dev:http`: HTTP bridge with watch mode
- `npm start`: Legacy combined mode
- `npm run dev`: Legacy combined mode with watch

## Logging

The server logs to stderr:

- `[MCP]`: STDIO server messages
- `[BRIDGE]`: HTTP bridge messages
- Tool execution logs with timing
- Error details with context

## Files Structure

```
src/
├── stdio.js          # Pure STDIO MCP server
├── http-bridge.js     # HTTP JSON-RPC bridge
└── server.js          # Legacy combined mode
```

## Troubleshooting

### STDIO Issues

- Check Node.js version (18+ required)
- Verify environment variables are set
- Check stderr for MCP server logs

### HTTP Bridge Issues

- Ensure port 4000 is free
- Check STDIO child process is spawning
- Verify JSON-RPC request format

### Jira Issues

- Test OAuth credentials manually
- Check JIRA_CLOUD_ID is correct UUID
- Verify API token hasn't expired
- Ensure proper scopes are configured

### Perplexity Issues

- Verify API key is valid
- Check rate limits haven't been exceeded
- Test API endpoint manually

## Production Deployment

### Docker Deployment (Recommended)

Create `Dockerfile`:

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --only=production
COPY src/ ./src/
COPY env.example ./
EXPOSE 4000
CMD ["npm", "run", "http"]
```

Build and run:

```bash
docker build -t mcp-server .
docker run -p 4000:4000 --env-file .env mcp-server
```

### Environment Variables for Production

```bash
# Required for HTTP mode
MCP_HTTP_PORT=4000

# Security (recommended for production)
MCP_HTTP_TOKEN=your_secure_bearer_token

# Jira Integration
JIRA_OAUTH_CLIENT_ID=your_oauth_client_id
JIRA_OAUTH_CLIENT_SECRET=your_oauth_client_secret
JIRA_CLOUD_ID=your_cloud_id_uuid

# Perplexity Integration
PERPLEXITY_API_KEY=pplx-your-key-here

# Optional
NODE_ENV=production
LOG_LEVEL=info
```

### Load Balancing & High Availability

For production workloads:

1. **Multiple instances** behind a load balancer
2. **Health checks** on `/health` endpoint
3. **Monitoring** via logs and metrics
4. **Process management** (PM2, systemd, or container orchestrator)

Example with PM2:

```bash
npm install -g pm2
pm2 start src/http-bridge.js --name mcp-server --instances 2
pm2 save
pm2 startup
```

## Team Integration Guide

### For Frontend Teams

Integrate the MCP server into your web application:

```typescript
// MCP Client Example
class MCPClient {
  constructor(private baseUrl: string, private token?: string) {}

  async listTools() {
    const response = await fetch(`${this.baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.token && { Authorization: `Bearer ${this.token}` }),
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "listTools",
        id: Date.now(),
      }),
    });

    const result = await response.json();
    return result.result.tools;
  }

  async callTool(name: string, args: Record<string, any>) {
    const response = await fetch(`${this.baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.token && { Authorization: `Bearer ${this.token}` }),
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "callTool",
        params: { name, arguments: args },
        id: Date.now(),
      }),
    });

    const result = await response.json();
    if (result.error) throw new Error(result.error.message);
    return result.result;
  }
}

// Usage
const mcp = new MCPClient("http://localhost:4000", "your_token");
const tools = await mcp.listTools();
const result = await mcp.callTool("add_numbers", { numbers: [1, 2, 3] });
```

### For Backend Teams

Use as a microservice:

```python
# Python client example
import requests
import json

class MCPClient:
    def __init__(self, base_url, token=None):
        self.base_url = base_url
        self.headers = {
            'Content-Type': 'application/json'
        }
        if token:
            self.headers['Authorization'] = f'Bearer {token}'

    def call_tool(self, name, arguments):
        payload = {
            'jsonrpc': '2.0',
            'method': 'callTool',
            'params': {
                'name': name,
                'arguments': arguments
            },
            'id': 1
        }

        response = requests.post(
            f'{self.base_url}/mcp',
            headers=self.headers,
            data=json.dumps(payload)
        )

        result = response.json()
        if 'error' in result:
            raise Exception(result['error']['message'])

        return result['result']

# Usage
mcp = MCPClient('http://localhost:4000', 'your_token')
result = mcp.call_tool('fetch_jira_ticket', {'ticketKey': 'PROJ-123'})
```

### For DevOps Teams

Monitoring and observability:

```yaml
# docker-compose.yml
version: "3.8"
services:
  mcp-server:
    build: .
    ports:
      - "4000:4000"
    environment:
      - MCP_HTTP_PORT=4000
      - MCP_HTTP_TOKEN=${MCP_TOKEN}
      - JIRA_OAUTH_CLIENT_ID=${JIRA_CLIENT_ID}
      - JIRA_OAUTH_CLIENT_SECRET=${JIRA_CLIENT_SECRET}
      - JIRA_CLOUD_ID=${JIRA_CLOUD_ID}
      - PERPLEXITY_API_KEY=${PERPLEXITY_KEY}
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:4000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
    restart: unless-stopped
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
```

### Testing & Validation

Use the provided test suites:

```bash
# Quick validation
./test-mcp-server.ps1

# Comprehensive testing with custom endpoint
./test-mcp-server.ps1 -BaseUrl "http://your-server:4000"

# CI/CD integration
./test-mcp-server.sh || exit 1
```

### Troubleshooting

Common issues and solutions:

1. **"Method not found" errors**: Ensure you're using correct method names or the HTTP bridge for automatic mapping
2. **Timeout errors**: Check if STDIO child process is healthy via `/health` endpoint
3. **Jira 403 errors**: Verify OAuth scopes and credentials
4. **Performance issues**: Monitor `/health` for restart counts and inflight requests

## Support & Contributing

- **Issues**: Report via GitHub issues
- **Documentation**: This README and inline code comments
- **Testing**: Run test suites before deployment
- **Security**: Never expose publicly without proper authentication

## License

MIT
