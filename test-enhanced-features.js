#!/usr/bin/env node

import dotenv from "dotenv";
import { fetchJiraTicketFull } from "./src/jira-client.js";

// Load environment variables
dotenv.config();

/**
 * Test the enhanced JIRA client with Sprint, Epic, and advanced time tracking
 */
async function testEnhancedFeatures() {
  console.log("🚀 Testing Enhanced JIRA Features");
  console.log("==================================\n");

  const config = {
    baseUrl: process.env.JIRA_BASE_URL || "https://username.atlassian.net",
    issueKey: process.env.TEST_TICKET_KEY || "SCRUM-8",
    auth: {
      email: process.env.JIRA_EMAIL,
      apiToken: process.env.JIRA_API_TOKEN,
    },
  };

  console.log("📋 Configuration:");
  console.log(`  Base URL: ${config.baseUrl}`);
  console.log(`  Test Ticket: ${config.issueKey}`);
  console.log(
    `  Credentials: ${config.auth.email ? "✓" : "✗"} Email, ${
      config.auth.apiToken ? "✓" : "✗"
    } Token\n`
  );

  if (!config.auth.email || !config.auth.apiToken) {
    console.error("❌ Missing JIRA credentials");
    process.exit(1);
  }

  try {
    console.log(`🔍 Fetching enhanced JIRA data for: ${config.issueKey}...`);

    const startTime = Date.now();
    const ticketData = await fetchJiraTicketFull(config);
    const duration = Date.now() - startTime;

    console.log(`✅ Enhanced data fetched in ${duration}ms\n`);

    // Test Sprint functionality
    console.log("🏃 Sprint Analysis:");
    if (ticketData.sprints && ticketData.sprints.length > 0) {
      console.log(`  Total Sprints: ${ticketData.sprints.length}`);
      console.log(`  Sprint Field ID: ${ticketData.sprintFieldId}`);

      ticketData.sprints.forEach((sprint, index) => {
        console.log(`  Sprint ${index + 1}: ${sprint.name} (${sprint.state})`);
        if (sprint.startDate) console.log(`    Start: ${sprint.startDate}`);
        if (sprint.endDate) console.log(`    End: ${sprint.endDate}`);
        if (sprint.goal) console.log(`    Goal: ${sprint.goal}`);
      });

      if (ticketData.activeSprint) {
        console.log(`  🎯 Active Sprint: ${ticketData.activeSprint.name}`);
      } else {
        console.log(`  🎯 No active sprint`);
      }
    } else {
      console.log(
        "  No sprints found (field not configured or ticket not in sprint)"
      );
    }

    // Test Epic functionality
    console.log("\n📈 Epic Analysis:");
    if (ticketData.epic) {
      console.log(
        `  Epic: ${ticketData.epic.key} (discovered via: ${ticketData.epic.source})`
      );
    } else {
      console.log("  No epic relationship found");
    }

    // Test enhanced time tracking
    console.log("\n⏱️  Enhanced Time Tracking:");
    const tt = ticketData.timeTracking;
    if (tt.originalEstimate || tt.timeSpent || tt.remainingEstimate) {
      console.log("  Pretty Formatted:");
      if (tt.originalEstimate)
        console.log(`    Original: ${tt.originalEstimate}`);
      if (tt.timeSpent) console.log(`    Spent: ${tt.timeSpent}`);
      if (tt.remainingEstimate)
        console.log(`    Remaining: ${tt.remainingEstimate}`);
    }

    if (
      tt.originalEstimateSeconds ||
      tt.timeSpentSeconds ||
      tt.remainingEstimateSeconds
    ) {
      console.log("  Raw Seconds:");
      if (tt.originalEstimateSeconds)
        console.log(`    Original: ${tt.originalEstimateSeconds}s`);
      if (tt.timeSpentSeconds)
        console.log(`    Spent: ${tt.timeSpentSeconds}s`);
      if (tt.remainingEstimateSeconds)
        console.log(`    Remaining: ${tt.remainingEstimateSeconds}s`);
    }

    if (
      tt.aggregate?.originalEstimateSeconds ||
      tt.aggregate?.timeSpentSeconds ||
      tt.aggregate?.remainingEstimateSeconds
    ) {
      console.log("  Aggregate (with subtasks):");
      if (tt.aggregate.originalEstimateSeconds)
        console.log(`    Original: ${tt.aggregate.originalEstimateSeconds}s`);
      if (tt.aggregate.timeSpentSeconds)
        console.log(`    Spent: ${tt.aggregate.timeSpentSeconds}s`);
      if (tt.aggregate.remainingEstimateSeconds)
        console.log(`    Remaining: ${tt.aggregate.remainingEstimateSeconds}s`);
    }

    if (!tt.originalEstimate && !tt.timeSpent && !tt.originalEstimateSeconds) {
      console.log("  No time tracking data found");
    }

    // Test Story Points (existing feature)
    console.log("\n📊 Story Points:");
    if (ticketData.storyPoints) {
      console.log(
        `  Points: ${ticketData.storyPoints} (field: ${ticketData.storyPointsFieldId})`
      );
    } else {
      console.log("  No story points configured or set");
    }

    console.log("\n🎉 Enhanced features test completed successfully!");
    console.log("\n📝 Summary of New Capabilities:");
    console.log("  ✅ Sprint discovery and parsing");
    console.log("  ✅ Epic relationship detection (parent + legacy Epic Link)");
    console.log("  ✅ Enhanced time tracking (pretty + raw + aggregate)");
    console.log("  ✅ Comprehensive custom field mapping");
  } catch (error) {
    console.error("\n❌ Enhanced features test failed:", error.message);
    process.exit(1);
  }
}

// Run the test
testEnhancedFeatures().catch(console.error);
