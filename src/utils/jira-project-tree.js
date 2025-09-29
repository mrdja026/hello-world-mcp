import axios from "axios";

/** ---------- Auth header (Bearer OR Basic) ---------- */
function makeAuthHeader({ email, apiToken, bearer }) {
  if (bearer) return { Authorization: `Bearer ${bearer}` };
  if (email && apiToken) {
    const b64 = Buffer.from(`${email}:${apiToken}`).toString("base64");
    return { Authorization: `Basic ${b64}` };
  }
  throw new Error("Provide either { bearer } or { email, apiToken }");
}

/** ---------- Field-name helpers ---------- */
function findFieldIdByDisplay(names = {}, regexes = []) {
  for (const [fieldId, display] of Object.entries(names)) {
    if (regexes.some((re) => re.test(display))) return fieldId; // e.g. "customfield_10014"
  }
  return null;
}

const idNum = (customfield) => (customfield || "").replace(/^customfield_/, "");

/** ---------- JQL search with pagination (POST /rest/api/3/search only) ---------- */
async function jqlSearchPaged({
  baseUrl,
  headers,
  jql,
  fields = [],
  pageSize = 100,
  expandNamesOnce = false,
}) {
  const url = `${baseUrl.replace(/\/+$/, "")}/rest/api/3/search`;
  const urlJql = `${baseUrl.replace(/\/+$/, "")}/rest/api/3/search/jql`;
  const issues = [];
  let startAt = 0;
  let names = null;

  while (true) {
    const body = {
      jql,
      startAt,
      maxResults: pageSize,
      fields: fields.length ? fields : [],
      fieldsByKeys: false,
      // omit validate/validateQuery for maximum compatibility
      // Avoid expand to prevent payload incompatibilities; keep minimal
    };
    let data;
    try {
      ({ data } = await axios.post(urlJql, body, {
        headers: { ...headers, "Content-Type": "application/json" },
      }));
    } catch (err1) {
      try {
        ({ data } = await axios.post(url, body, {
          headers: { ...headers, "Content-Type": "application/json" },
        }));
      } catch (err2) {
        // Last-resort: GET /search with query params
        const params = {
          jql,
          startAt,
          maxResults: pageSize,
        };
        if (fields.length) params.fields = fields.join(",");
        const resp = await axios.get(url, { headers, params });
        data = resp.data;
      }
    }
    // Some sites still return names in POST body when requested; ignore for now
    if (expandNamesOnce && startAt === 0 && data?.names && !names)
      names = data.names;

    const page = Array.isArray(data?.issues) ? data.issues : [];
    issues.push(...page);
    if (!page.length || startAt + page.length >= (data.total || 0)) break;
    startAt += page.length;
  }

  return { issues, names };
}

/** ---------- Normalize a subset of fields for nodes ---------- */
function normIssue(issue, { storyPointsFieldId, sprintFieldId } = {}) {
  const f = issue.fields || {};
  const sp =
    storyPointsFieldId && f.hasOwnProperty(storyPointsFieldId)
      ? f[storyPointsFieldId]
      : null;
  const sprint =
    sprintFieldId && f.hasOwnProperty(sprintFieldId) ? f[sprintFieldId] : null;

  return {
    id: issue.id,
    key: issue.key,
    summary: f.summary || null,
    status: f.status?.name || null,
    issuetype: f.issuetype?.name || null,
    priority: f.priority?.name || null,
    assignee: f.assignee?.displayName || null,
    reporter: f.reporter?.displayName || null,
    storyPoints: typeof sp === "number" ? sp : sp ? Number(sp) : null,
    sprint: sprint || null,
    timeTracking: {
      originalEstimate: f.timetracking?.originalEstimate ?? null,
      remainingEstimate: f.timetracking?.remainingEstimate ?? null,
      timeSpent: f.timetracking?.timeSpent ?? null,
      originalEstimateSeconds: f.timeoriginalestimate ?? null,
      remainingEstimateSeconds: f.timeestimate ?? null,
      timeSpentSeconds: f.timespent ?? null,
      aggregate: {
        originalEstimateSeconds: f.aggregatetimeoriginalestimate ?? null,
        remainingEstimateSeconds: f.aggregatetimeestimate ?? null,
        timeSpentSeconds: f.aggregatetimespent ?? null,
      },
    },
  };
}

/** ---------- Build 3-level tree: Project -> Epics -> Issues -> Subtasks ---------- */
async function fetchProjectTree3Levels({
  baseUrl,
  auth, // { email, apiToken } or { bearer }
  projectKeyOrId, // e.g. "WEB" or 10010
  pageSize = 100,
}) {
  const headers = { Accept: "application/json", ...makeAuthHeader(auth) };

  // 0) Discover Story Points + Sprint IDs once via expand=names
  //    (We can piggyback on the epics query to get `names`.)
  const baseFields = [
    "summary",
    "status",
    "issuetype",
    "priority",
    "assignee",
    "reporter",
    "timetracking",
    "timeoriginalestimate",
    "timeestimate",
    "timespent",
    "aggregatetimeoriginalestimate",
    "aggregatetimeestimate",
    "aggregatetimespent",
    "subtasks",
    "parent",
  ];

  // 1) Get all Epics in the project (discover custom fields once)
  const epicsJql = `project = "${projectKeyOrId}" AND issuetype = Epic ORDER BY rank`;
  const { issues: epicIssues, names } = await jqlSearchPaged({
    baseUrl,
    headers,
    jql: epicsJql,
    fields: baseFields,
    pageSize,
    expandNamesOnce: false,
  });

  // Map field ids
  const storyPointsFieldId = findFieldIdByDisplay(names || {}, [
    /story\s*points?/i,
    /story\s*point\s*estimate/i,
  ]);
  const sprintFieldId = findFieldIdByDisplay(names || {}, [/^sprint$/i]);

  // Normalize epics
  const epics = epicIssues.map((e) =>
    normIssue(e, { storyPointsFieldId, sprintFieldId })
  );
  const epicKeys = epics.map((e) => e.key);
  const epicKeySet = new Set(epicKeys);

  // 2) Get children per epic via "Epic Link" (simple and reliable across projects)
  let childIssues = [];
  if (epicKeys.length) {
    for (const epicKey of epicKeys) {
      const childrenJql = `project = "${projectKeyOrId}" AND \"Epic Link\" = ${epicKey}`;
      const { issues: children } = await jqlSearchPaged({
        baseUrl,
        headers,
        jql: childrenJql,
        fields: baseFields,
        pageSize,
      });
      const normalized = children.map((i) => normIssue(i, {}));
      childIssues.push(...normalized);
      if (!childrenByEpic.has(epicKey)) childrenByEpic.set(epicKey, []);
      childrenByEpic.get(epicKey).push(...normalized);
    }
  }

  const childrenByEpic = new Map(epicKeys.map((k) => [k, []]));

  // childrenByEpic already populated by epic-specific queries above

  // 3) Fetch all subtasks for those children (level 3)
  let subtasksByParent = new Map();
  if (childIssues.length) {
    const parentKeys = childIssues.map((i) => i.key);
    const chunks = (arr, n = 50) =>
      arr.reduce(
        (a, _, ix) => (ix % n ? a : [...a, arr.slice(ix, ix + n)]),
        []
      );
    const parentKeyChunks = chunks(parentKeys, 50);
    const allSubtasks = [];
    for (const group of parentKeyChunks) {
      const { issues } = await jqlSearchPaged({
        baseUrl,
        headers,
        jql: `parent in (${group.map((k) => `"${k}"`).join(",")})`,
        fields: baseFields.concat(
          storyPointsFieldId ? [storyPointsFieldId] : [],
          sprintFieldId ? [sprintFieldId] : []
        ),
        pageSize,
      });
      allSubtasks.push(...issues);
    }
    const normalizedSubs = allSubtasks.map((s) =>
      normIssue(s, { storyPointsFieldId, sprintFieldId })
    );
    subtasksByParent = new Map();

    // rehydrate parent mapping from the already fetched 'parent' field
    for (const raw of allSubtasks) {
      const parentKey = raw.fields?.parent?.key;
      if (!parentKey) continue;
      const norm = normalizedSubs.find((n) => n.key === raw.key);
      if (!subtasksByParent.has(parentKey)) subtasksByParent.set(parentKey, []);
      subtasksByParent.get(parentKey).push(norm);
    }
  }

  // 4) Build final tree: for each epic → attach children → attach subtasks
  const epicsWithChildren = epics.map((e) => {
    const children = childrenByEpic.get(e.key) || [];
    const childrenWithSubs = children.map((ch) => ({
      ...ch,
      subtasks: subtasksByParent.get(ch.key) || [],
    }));
    return { ...e, children: childrenWithSubs };
  });

  return {
    project: projectKeyOrId,
    levels: 3,
    stats: {
      epics: epics.length,
      children: childIssues.length,
      subtasks: Array.from(subtasksByParent.values()).reduce(
        (a, arr) => a + arr.length,
        0
      ),
    },
    epics: epicsWithChildren,
  };
}

export { fetchProjectTree3Levels };
