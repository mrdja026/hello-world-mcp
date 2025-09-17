#!/usr/bin/env node

import axios from "axios";

/**
 * ADF to text converter for JIRA Cloud descriptions
 * ADF spec: https://developer.atlassian.com/cloud/jira/platform/apis/document/structure/
 */
function adfToText(adf) {
  if (!adf || typeof adf !== "object") return "";

  const walk = (node) => {
    if (!node) return "";
    switch (node.type) {
      case "text":
        return node.text || "";
      case "hardBreak":
        return "\n";
      case "paragraph":
        return (node.content || []).map(walk).join("") + "\n";
      case "bulletList":
      case "orderedList":
      case "listItem":
      case "heading":
      case "blockquote":
      case "panel":
      case "table":
        return (node.content || []).map(walk).join("");
      default:
        return (node.content || []).map(walk).join("");
    }
  };

  return walk(adf).trim();
}

/**
 * Dynamic Story Points field discovery
 * Resolves the site-specific custom field id for Story Points by scanning the `names` map
 * returned when using `expand=names` on the Get Issue API.
 * Works for "Story Points" and "Story point estimate" across project types.
 */
function findStoryPointsFieldId(names = {}) {
  const entries = Object.entries(names); // [ [fieldId, displayName], ... ]
  const matcher = /story\s*points?/i;
  const altMatcher = /story\s*point\s*estimate/i;

  const hit =
    entries.find(([, name]) => matcher.test(name)) ||
    entries.find(([, name]) => altMatcher.test(name));

  return hit ? hit[0] : null; // fieldId like "customfield_10016"
}

/**
 * Normalize issue links into structured format
 * Normalize issuelinks into a neat array:
 * [{ linkId, typeName, direction: 'outward'|'inward', key, id }]
 * Docs: request fields=issuelinks; outwardIssue/inwardIssue present per link.
 */
function mapIssueLinks(links = []) {
  const result = [];
  for (const link of links) {
    const typeName = link?.type?.name || null;

    if (link.outwardIssue) {
      result.push({
        linkId: link.id || null,
        typeName,
        direction: "outward",
        key: link.outwardIssue.key || null,
        id: link.outwardIssue.id || null,
      });
    }

    if (link.inwardIssue) {
      result.push({
        linkId: link.id || null,
        typeName,
        direction: "inward",
        key: link.inwardIssue.key || null,
        id: link.inwardIssue.id || null,
      });
    }
  }
  return result;
}

/**
 * Enhanced JIRA ticket fetcher with robust error handling
 * Fetch a "full ticket" snapshot in one call.
 * - Includes: summary, status, issueType, priority, storyPoints, description (ADF + plain text),
 *             parent/subtasks, labels, components, fixVersions, assignee/reporter, links (related tickets).
 *
 * @param {Object} cfg
 * @param {string} cfg.baseUrl  e.g. "https://your-domain.atlassian.net"
 * @param {string} cfg.issueKey e.g. "SCRUM-8"
 * @param {Object} cfg.auth     { email, apiToken }
 */
export async function fetchJiraTicketFull({ baseUrl, issueKey, auth }) {
  const headers = {
    Accept: "application/json",
    Authorization: `Basic ${Buffer.from(
      `${auth.email}:${auth.apiToken}`
    ).toString("base64")}`,
  };

  // Ask only for the fields we need; add issuelinks explicitly and expand=names to resolve custom ids.
  const fields = [
    "summary",
    "status",
    "issuetype",
    "priority",
    "parent",
    "subtasks",
    "labels",
    "components",
    "fixVersions",
    "assignee",
    "reporter",
    "description",
    "issuelinks",
    "project",
    "resolution",
    "created",
    "updated",
    "duedate",
    "resolutiondate",
    "timetracking",
    "attachment",
    "comment",
    "watches",
    "votes",
    "progress",
    "versions",
    "environment",
  ];

  const url = `${baseUrl.replace(
    /\/+$/,
    ""
  )}/rest/api/3/issue/${encodeURIComponent(issueKey)}`;

  try {
    console.log(`Making JIRA API call to: ${url}`);
    console.log(`Fields requested: ${fields.join(", ")}`);

    const { data } = await axios.get(url, {
      headers,
      params: {
        fields: fields.join(","),
        expand: "names", // For dynamic custom field discovery
      },
    });

    console.log(`JIRA API response received for ${issueKey}`);
    const { fields: f = {}, names = {} } = data || {};

    // Debug logging for field structure
    console.log("JIRA response structure:", {
      hasFields: !!f,
      hasStatus: !!f.status,
      hasIssueType: !!f.issuetype,
      fieldKeys: Object.keys(f).slice(0, 10),
      namesCount: Object.keys(names).length,
    });

    // Dynamic Story Points discovery
    const storyPointsFieldId = findStoryPointsFieldId(names);
    let storyPoints = null;

    if (storyPointsFieldId && f.hasOwnProperty(storyPointsFieldId)) {
      const raw = f[storyPointsFieldId];
      storyPoints = typeof raw === "number" ? raw : raw ? Number(raw) : null;
      console.log(
        `Story Points found in field ${storyPointsFieldId}: ${storyPoints}`
      );
    } else {
      console.log("Story Points field not found or not set");
    }

    // Handle ADF description format (Cloud) vs HTML (Server)
    const descriptionADF = f.description || null;
    let descriptionText;

    if (descriptionADF && typeof descriptionADF === "object") {
      // ADF format (Cloud)
      descriptionText = adfToText(descriptionADF);
      console.log("Processed ADF description format");
    } else {
      // Plain text or HTML format (Server)
      descriptionText = descriptionADF || null;
      console.log("Using plain/HTML description format");
    }

    // Normalize linked issues
    const relatedIssues = mapIssueLinks(f.issuelinks || []);
    console.log(`Found ${relatedIssues.length} linked issues`);

    // Build comprehensive normalized ticket data with safe property access
    const ticketData = {
      // Basic identification
      key: data.key,
      id: data.id,
      self: data.self,
      summary: f.summary || null,
      description: descriptionText,

      // Status and workflow (with safe access)
      status: {
        name: f.status?.name || "Unknown",
        id: f.status?.id || "unknown",
        statusCategory: f.status?.statusCategory?.name || "Unknown",
        description: f.status?.description || "",
      },

      // Issue classification
      issueType: {
        name: f.issuetype?.name || "Unknown",
        id: f.issuetype?.id || "unknown",
        description: f.issuetype?.description || "",
        iconUrl: f.issuetype?.iconUrl || "",
      },

      // Priority (with safe access)
      priority: {
        name: f.priority?.name || "Not set",
        id: f.priority?.id || null,
        iconUrl: f.priority?.iconUrl || null,
      },

      // People (with safe access)
      assignee: {
        displayName: f.assignee?.displayName || "Unassigned",
        accountId: f.assignee?.accountId || null,
        emailAddress: f.assignee?.emailAddress || null,
        avatarUrls: f.assignee?.avatarUrls || null,
      },

      reporter: {
        displayName: f.reporter?.displayName || "Unknown",
        accountId: f.reporter?.accountId || null,
        emailAddress: f.reporter?.emailAddress || null,
        avatarUrls: f.reporter?.avatarUrls || null,
      },

      // Dates
      created: f.created || null,
      updated: f.updated || null,
      duedate: f.duedate || null,
      resolutiondate: f.resolutiondate || null,

      // Project information
      project: {
        key: f.project?.key || "Unknown",
        name: f.project?.name || "Unknown",
        id: f.project?.id || "unknown",
        projectTypeKey: f.project?.projectTypeKey || "unknown",
      },

      // Resolution
      resolution: f.resolution
        ? {
            name: f.resolution.name,
            description: f.resolution.description || "",
          }
        : null,

      // Components and versions
      components: (f.components || []).map((c) => ({
        name: c.name || "",
        id: c.id || "",
        description: c.description || "",
      })),

      fixVersions: (f.fixVersions || []).map((v) => ({
        name: v.name || "",
        id: v.id || "",
        description: v.description || "",
        released: v.released || false,
        releaseDate: v.releaseDate || null,
      })),

      affectedVersions: (f.versions || []).map((v) => ({
        name: v.name || "",
        id: v.id || "",
        description: v.description || "",
        released: v.released || false,
        releaseDate: v.releaseDate || null,
      })),

      // Labels and environment
      labels: f.labels || [],
      environment: f.environment || null,

      // Story points (dynamically discovered)
      storyPoints,
      storyPointsFieldId, // For caching per project

      // Time tracking
      timeTracking: f.timetracking
        ? {
            originalEstimate: f.timetracking.originalEstimate || null,
            remainingEstimate: f.timetracking.remainingEstimate || null,
            timeSpent: f.timetracking.timeSpent || null,
            originalEstimateSeconds:
              f.timetracking.originalEstimateSeconds || null,
            remainingEstimateSeconds:
              f.timetracking.remainingEstimateSeconds || null,
            timeSpentSeconds: f.timetracking.timeSpentSeconds || null,
          }
        : null,

      // Security level
      security: f.security
        ? {
            name: f.security.name,
            description: f.security.description || "",
          }
        : null,

      // Linked issues (normalized)
      linkedIssues: relatedIssues.map((link) => ({
        id: link.linkId,
        type: {
          name: link.typeName,
          inward: "", // Could be enhanced if needed
          outward: "", // Could be enhanced if needed
        },
        direction: link.direction,
        key: link.key,
        targetId: link.id,
        // Add placeholders for compatibility
        inwardIssue:
          link.direction === "inward"
            ? {
                key: link.key,
                summary: "",
                status: "",
                priority: "",
              }
            : null,
        outwardIssue:
          link.direction === "outward"
            ? {
                key: link.key,
                summary: "",
                status: "",
                priority: "",
              }
            : null,
      })),

      // Attachments
      attachmentsCount: f.attachment?.length || 0,
      attachments: (f.attachment || []).slice(0, 5).map((att) => ({
        id: att.id || "",
        filename: att.filename || "",
        size: att.size || 0,
        mimeType: att.mimeType || "",
        created: att.created || "",
        author: att.author?.displayName || "Unknown",
      })),

      // Comments
      commentsCount: f.comment?.total || 0,
      recentComments: (f.comment?.comments || []).slice(-3).map((comment) => ({
        id: comment.id || "",
        author: comment.author?.displayName || "Unknown",
        body: comment.body || "",
        created: comment.created || "",
        updated: comment.updated || "",
      })),

      // Activity metrics
      watchersCount: f.watches?.watchCount || 0,
      votesCount: f.votes?.votes || 0,

      // Progress
      progress: f.progress
        ? {
            progress: f.progress.progress || 0,
            total: f.progress.total || 0,
            percent: f.progress.percent || 0,
          }
        : null,

      // Parent/subtasks relationships
      parent: f.parent
        ? {
            key: f.parent.key || "",
            summary: f.parent.fields?.summary || "",
            status: f.parent.fields?.status?.name || "Unknown",
          }
        : null,

      subtasks: (f.subtasks || []).map((subtask) => ({
        key: subtask.key || "",
        summary: subtask.fields?.summary || "",
        status: subtask.fields?.status?.name || "Unknown",
        assignee: subtask.fields?.assignee?.displayName || "Unassigned",
      })),

      // Raw data for debugging (optional)
      raw: data,
    };

    console.log(`Successfully processed JIRA ticket ${issueKey}`);
    return ticketData;
  } catch (error) {
    console.error("JIRA API Error:", error.message);

    if (error.response) {
      const status = error.response.status;
      const message =
        error.response.data?.errorMessages?.[0] || error.response.statusText;

      console.error(`JIRA API HTTP ${status}:`, message);

      if (status === 404) {
        throw new Error(`JIRA ticket ${issueKey} not found`);
      } else if (status === 401) {
        throw new Error("JIRA authentication failed - check credentials");
      } else if (status === 403) {
        throw new Error("JIRA access denied - insufficient permissions");
      } else {
        throw new Error(`JIRA API error (${status}): ${message}`);
      }
    }

    throw new Error(`JIRA request failed: ${error.message}`);
  }
}

export { adfToText, findStoryPointsFieldId, mapIssueLinks };
