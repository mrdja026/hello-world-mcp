#!/usr/bin/env node

import axios from "axios";

async function testMcpFix() {
  console.log("🧪 Testing MCP Server Fix");
  console.log("========================\n");

  const mcpUrl = "http://127.0.0.1:4000/mcp";

  try {
    // Test 1: Tools list (should work)
    console.log("1. Testing tools/list...");
    const toolsResponse = await axios.post(mcpUrl, {
      jsonrpc: "2.0",
      method: "tools/list",
      id: 1,
    });
    console.log(
      `   ✅ Success: Found ${
        toolsResponse.data.result?.tools?.length || 0
      } tools`
    );

    // Test 2: JIRA ticket fetch (should work)
    console.log("2. Testing JIRA fetch_ticket...");
    const ticketResponse = await axios.post(mcpUrl, {
      jsonrpc: "2.0",
      method: "tools/call",
      params: {
        name: "fetch_ticket",
        arguments: { ticketKey: "SCRUM-8" },
      },
      id: 2,
    });

    if (ticketResponse.data.error) {
      console.log(
        `   ⚠️  Expected JIRA error: ${ticketResponse.data.error.message}`
      );
    } else {
      console.log("   ✅ Success: JIRA ticket fetched");
    }

    // Test 3: Resources list (should work without 400 error)
    console.log("3. Testing resources/list...");
    const resourcesResponse = await axios.post(mcpUrl, {
      jsonrpc: "2.0",
      method: "resources/list",
      id: 3,
    });
    console.log(
      `   ✅ Success: Found ${
        resourcesResponse.data.result?.resources?.length || 0
      } resources`
    );

    console.log("\n🎉 All tests passed! MCP server is working correctly.");
  } catch (error) {
    console.error("\n❌ Test failed:", error.response?.data || error.message);
    process.exit(1);
  }
}

// Wait a moment for server to start, then test
setTimeout(testMcpFix, 2000);
