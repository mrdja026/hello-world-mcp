#!/usr/bin/env node

import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

async function testFullIntegration() {
  console.log("🧪 Testing Full MCP Integration with Enhanced Features");
  console.log("====================================================\n");

  const mcpUrl = "http://127.0.0.1:4000/mcp";
  const ticketKey = process.env.TEST_TICKET_KEY || "SCRUM-8";

  try {
    console.log("🔍 Testing enhanced JIRA fetch via MCP...");

    const ticketResponse = await axios.post(mcpUrl, {
      jsonrpc: "2.0",
      method: "tools/call",
      params: {
        name: "fetch_ticket",
        arguments: { ticketKey: ticketKey },
      },
      id: 1,
    });

    if (ticketResponse.data.error) {
      throw new Error(`MCP Error: ${ticketResponse.data.error.message}`);
    }

    const result = ticketResponse.data.result;
    const ticketText = result.content[0].text;

    console.log("✅ Successfully fetched enhanced JIRA ticket via MCP");
    console.log(`📝 Response length: ${ticketText.length} characters\n`);

    // Check for enhanced features in the response
    const checks = {
      "Sprint Information": ticketText.includes("ACTIVE SPRINT:"),
      "Epic Information": ticketText.includes("EPIC:"),
      "Enhanced Time Tracking":
        ticketText.includes("Raw Seconds:") ||
        ticketText.includes("With Subtasks:"),
      "Sprint History": ticketText.includes("SPRINT HISTORY:"),
      "Basic Story Points": ticketText.includes("STORY POINTS:"),
    };

    console.log("🔍 Enhanced Feature Detection:");
    Object.entries(checks).forEach(([feature, found]) => {
      console.log(
        `  ${found ? "✅" : "⚠️ "} ${feature}: ${found ? "Found" : "Not found"}`
      );
    });

    const enhancedFeatureCount = Object.values(checks).filter(Boolean).length;
    console.log(`\n📊 Enhanced features detected: ${enhancedFeatureCount}/5`);

    // Show relevant parts of the response
    console.log("\n📋 Enhanced Response Preview:");
    console.log("─".repeat(60));

    // Extract and show Sprint section
    const sprintMatch = ticketText.match(
      /ACTIVE SPRINT:[\s\S]*?(?=\n\n|\n[A-Z]|$)/
    );
    if (sprintMatch) {
      console.log("🏃 " + sprintMatch[0].trim());
      console.log("");
    }

    // Extract and show Epic section
    const epicMatch = ticketText.match(/EPIC:.*$/m);
    if (epicMatch) {
      console.log("📈 " + epicMatch[0].trim());
      console.log("");
    }

    // Extract and show Sprint History
    const historyMatch = ticketText.match(/SPRINT HISTORY:.*$/m);
    if (historyMatch) {
      console.log("📊 " + historyMatch[0].trim());
      console.log("");
    }

    console.log("─".repeat(60));

    if (enhancedFeatureCount >= 3) {
      console.log("\n🎉 Enhanced MCP integration test PASSED!");
      console.log("🚀 Advanced JIRA features are working correctly via MCP");
    } else {
      console.log(
        "\n⚠️  Some enhanced features may not be available for this ticket"
      );
      console.log(
        "   This could be normal if the ticket has no Sprint/Epic/Time data"
      );
    }
  } catch (error) {
    console.error("\n❌ Full integration test failed:", error.message);
    if (error.code === "ECONNREFUSED") {
      console.log(
        "💡 Make sure MCP server is running: MCP_HTTP_PORT=4000 node src/server.js"
      );
    }
    process.exit(1);
  }
}

// Wait for server startup, then test
setTimeout(testFullIntegration, 3000);
