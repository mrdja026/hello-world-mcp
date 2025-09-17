#!/usr/bin/env node

import axios from "axios";

/**
 * Auth header helper (Bearer OR Basic)
 * Supports both API token and OAuth bearer token authentication
 */
export function makeAuthHeader({ email, apiToken, bearer }) {
  if (bearer) return { Authorization: `Bearer ${bearer}` };
  if (email && apiToken) {
    const b64 = Buffer.from(`${email}:${apiToken}`).toString("base64");
    return { Authorization: `Basic ${b64}` };
  }
  throw new Error("Provide either { bearer } or { email, apiToken }");
}

/**
 * Small pagination helper for JIRA APIs
 * Handles both "isLast/nextPage" style and traditional startAt/total pagination
 */
export async function pagedGet(
  url,
  { headers, params = {}, collectPath = "values" }
) {
  const all = [];
  let startAt = params.startAt || 0;
  const maxResults = params.maxResults || 50;

  console.log(`Starting paginated fetch from: ${url}`);

  // Using "isLast/nextPage" style where available; otherwise fall back to startAt/total
  while (true) {
    console.log(`Fetching page: startAt=${startAt}, maxResults=${maxResults}`);

    const { data } = await axios.get(url, {
      headers,
      params: { ...params, startAt, maxResults },
    });

    const pageValues = Array.isArray(data[collectPath])
      ? data[collectPath]
      : [];
    all.push(...pageValues);

    console.log(
      `Page received: ${pageValues.length} items, total so far: ${all.length}`
    );

    // Prefer "isLast/nextPage" (Agile + Project search) else compute via total
    const isLast = data.isLast === true || pageValues.length === 0;
    if (isLast) {
      console.log("Pagination complete: isLast=true or no more items");
      break;
    }

    // Some endpoints return total; if present, stop when we've read all
    if (typeof data.total === "number") {
      const next = startAt + pageValues.length;
      if (next >= data.total) {
        console.log(`Pagination complete: reached total (${data.total})`);
        break;
      }
      startAt = next;
    } else if (data.nextPage) {
      // If nextPage is present use it directly
      const u = new URL(data.nextPage);
      startAt = Number(
        u.searchParams.get("startAt") || startAt + pageValues.length
      );
      console.log(`Using nextPage URL, new startAt: ${startAt}`);
    } else {
      // Fallback: move by page length
      startAt += pageValues.length;
      console.log(`Fallback pagination, new startAt: ${startAt}`);
    }
  }

  console.log(`Pagination complete: ${all.length} total items collected`);
  return all;
}
