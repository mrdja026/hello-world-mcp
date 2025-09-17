#!/usr/bin/env node

import axios from "axios";
import { makeAuthHeader, pagedGet } from "./jira-common-utils.js";

/**
 * PROJECT SEARCH (v3)
 * One-shot search over projects with filters.
 * Normalizes to: id, key, name, type, category, simplified/style, avatarUrls.
 *
 * Params (all optional):
 *   query: string (matches name/key)
 *   status: 'live' | 'archived' | 'deleted' (Cloud supports status filtering)
 *   categoryId: string
 *   maxResults: number
 */
export async function searchProjects({
  baseUrl,
  auth,
  query,
  status,
  categoryId,
  maxResults = 50,
}) {
  const headers = { Accept: "application/json", ...makeAuthHeader(auth) };
  const url = `${baseUrl.replace(/\/+$/, "")}/rest/api/3/project/search`;

  const params = {};
  if (query) params.query = query;
  if (status) params.status = status; // e.g. 'archived' or 'live'
  if (categoryId) params.categoryId = categoryId;

  console.log(`Searching projects with params:`, params);

  const projects = await pagedGet(url, {
    headers,
    params: { ...params, maxResults },
    collectPath: "values",
  });

  const normalizedProjects = projects.map((p) => ({
    id: p.id,
    key: p.key,
    name: p.name,
    projectTypeKey: p.projectTypeKey || p.style || null,
    simplified: p.simplified ?? null,
    style: p.style ?? null,
    category: p.projectCategory
      ? { id: p.projectCategory.id, name: p.projectCategory.name }
      : null,
    avatarUrls: p.avatarUrls || {},
    self: p.self,
  }));

  console.log(`Found ${normalizedProjects.length} projects`);
  return normalizedProjects;
}

/**
 * BOARD SEARCH (Agile v1.0)
 * One-shot board search with optional filters:
 *   name, type ('scrum'|'kanban'), projectKeyOrId
 * Returns boards and (optionally) attaches config + active sprints.
 *
 * opts:
 *   includeConfig: boolean (default true) => /board/{id}/configuration
 *   includeActiveSprints: boolean (default true) => /board/{id}/sprint?state=active
 *   includeProjects: boolean (default true) => /board/{id}/project
 */
export async function searchBoardsFull({
  baseUrl,
  auth,
  name,
  type, // 'scrum' | 'kanban'
  projectKeyOrId, // e.g. 'PROJ' or '10010'
  maxResults = 50,
  includeConfig = true,
  includeActiveSprints = true,
  includeProjects = true,
}) {
  const headers = { Accept: "application/json", ...makeAuthHeader(auth) };
  const url = `${baseUrl.replace(/\/+$/, "")}/rest/agile/1.0/board`;

  const params = {};
  if (name) params.name = name;
  if (type) params.type = type;
  if (projectKeyOrId) params.projectKeyOrId = projectKeyOrId;

  console.log(`Searching boards with params:`, params);

  const boards = await pagedGet(url, {
    headers,
    params: { ...params, maxResults },
    collectPath: "values",
  });

  console.log(
    `Found ${boards.length} boards, enriching with additional data...`
  );

  const results = [];
  for (const b of boards) {
    console.log(`Processing board: ${b.name} (${b.id})`);

    const baseBoard = {
      id: b.id,
      name: b.name,
      type: b.type,
      self: b.self,
      location: b.location
        ? {
            type: b.location.type,
            projectId: b.location.projectId ?? null,
            projectKey: b.location.projectKey ?? null,
            name: b.location.name ?? b.location.displayName ?? null,
          }
        : null,
    };

    // Config
    let config = null;
    if (includeConfig) {
      try {
        console.log(`Fetching config for board ${b.id}`);
        const { data: cfg } = await axios.get(
          `${baseUrl.replace(/\/+$/, "")}/rest/agile/1.0/board/${
            b.id
          }/configuration`,
          { headers }
        );
        config = {
          filterId: cfg?.filter?.id ?? null,
          estimation: cfg?.estimation?.field
            ? {
                displayName: cfg.estimation.field.displayName,
                fieldId: cfg.estimation.field.fieldId,
              }
            : null,
          columns: (cfg?.columnConfig?.columns || []).map((c) => ({
            name: c.name,
            statusIds: (c.statuses || []).map((s) => s.id),
          })),
          rankingFieldId: cfg?.ranking?.rankCustomFieldId ?? null,
          location: cfg?.location
            ? {
                type: cfg.location.type,
                projectId: cfg.location.projectId ?? null,
                projectKey: cfg.location.key ?? cfg.location.projectKey ?? null,
                name: cfg.location.name ?? cfg.location.displayName ?? null,
              }
            : null,
        };
        console.log(
          `Config loaded for board ${b.id}: ${config.columns.length} columns, filter ${config.filterId}`
        );
      } catch (e) {
        console.warn(`Failed to load config for board ${b.id}:`, e.message);
        config = null;
      }
    }

    // Active sprints
    let activeSprints = [];
    if (includeActiveSprints) {
      try {
        console.log(`Fetching active sprints for board ${b.id}`);
        const { data: spr } = await axios.get(
          `${baseUrl.replace(/\/+$/, "")}/rest/agile/1.0/board/${b.id}/sprint`,
          { headers, params: { state: "active", maxResults: 50 } }
        );
        activeSprints = (spr?.values || [])
          .filter((s) => s.state === "active")
          .map((s) => ({
            id: s.id,
            name: s.name,
            state: s.state,
            startDate: s.startDate ?? null,
            endDate: s.endDate ?? null,
            completeDate: s.completeDate ?? null,
            originBoardId: s.originBoardId ?? null,
            goal: s.goal ?? null,
          }));
        console.log(
          `Found ${activeSprints.length} active sprints for board ${b.id}`
        );
      } catch (e) {
        console.warn(`Failed to load sprints for board ${b.id}:`, e.message);
        activeSprints = [];
      }
    }

    // Projects attached to board
    let projects = [];
    if (includeProjects) {
      try {
        console.log(`Fetching projects for board ${b.id}`);
        const projectsList = await pagedGet(
          `${baseUrl.replace(/\/+$/, "")}/rest/agile/1.0/board/${b.id}/project`,
          { headers, collectPath: "values", params: { maxResults: 50 } }
        );
        projects = projectsList.map((p) => ({
          id: p.id,
          key: p.key,
          name: p.name,
          projectTypeKey: p.projectTypeKey || null,
          simplified: p.simplified ?? null,
          style: p.style ?? null,
          avatarUrls: p.avatarUrls || {},
        }));
        console.log(`Found ${projects.length} projects for board ${b.id}`);
      } catch (e) {
        console.warn(`Failed to load projects for board ${b.id}:`, e.message);
        projects = [];
      }
    }

    results.push({ ...baseBoard, config, activeSprints, projects });
  }

  console.log(
    `Completed board search: ${results.length} boards with full data`
  );
  return results;
}

/**
 * Convenience: find boards for each project
 */
export async function searchProjectsWithBoards({
  baseUrl,
  auth,
  projectQuery,
  projectStatus,
  projectCategoryId,
  boardType,
  includeConfig = true,
  includeActiveSprints = true,
}) {
  console.log("Starting combined project + board search");

  const projects = await searchProjects({
    baseUrl,
    auth,
    query: projectQuery,
    status: projectStatus,
    categoryId: projectCategoryId,
  });

  console.log(
    `Found ${projects.length} projects, now fetching boards for each...`
  );

  const byProject = [];
  for (const p of projects) {
    console.log(`Fetching boards for project: ${p.name} (${p.key})`);
    const boards = await searchBoardsFull({
      baseUrl,
      auth,
      projectKeyOrId: p.key,
      type: boardType,
      includeConfig,
      includeActiveSprints,
    });
    byProject.push({ project: p, boards });
    console.log(`Project ${p.key}: ${boards.length} boards found`);
  }

  console.log(
    `Completed combined search: ${byProject.length} projects with boards`
  );
  return byProject;
}
