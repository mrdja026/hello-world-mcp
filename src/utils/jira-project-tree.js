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

/** ---------- JQL search with pagination (Enhanced Search: /rest/api/3/search/jql) ---------- */
async function jqlSearchPaged({
  baseUrl,
  headers,
  jql,
  fields = [],
  pageSize = 100,
}) {
  const urlJql = `${baseUrl.replace(/\/+$/, "")}/rest/api/3/search/jql`;
  const issues = [];
  let nextPageToken = undefined;
  while (true) {
    const body = {
      jql,
      maxResults: pageSize,
      fields: fields.length ? fields : [],
      fieldsByKeys: false,
      ...(nextPageToken ? { nextPageToken } : {}),
    };
    const { data } = await axios.post(urlJql, body, {
      headers: {
        ...headers,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    });
    issues.push(...(data?.issues || []));
    nextPageToken = data?.nextPageToken;
    if (!nextPageToken) break;
  }
  return { issues };
}

/** ---------- Normalize a subset of fields for nodes ---------- */
function normIssue(issue) {
  const f = issue.fields || {};

  return {
    id: issue.id,
    key: issue.key,
    summary: f.summary || null,
    status: f.status?.name || null,
    issuetype: f.issuetype?.name || null,
    priority: f.priority?.name || null,
    assignee: f.assignee?.displayName || null,
    reporter: f.reporter?.displayName || null,
    parentKey: f.parent?.key || null,
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

  // Minimal field set to keep payloads simple and compatible
  const baseFields = [
    "key",
    "summary",
    "issuetype",
    "status",
    "assignee",
    "reporter",
    "priority",
    "parent",
    "subtasks",
  ];

  // 1) Get all Epics in the project (discover custom fields once)
  const epicsJql = `project = "${projectKeyOrId}" AND issuetype = Epic ORDER BY rank`;
  const { issues: epicIssues } = await jqlSearchPaged({
    baseUrl,
    headers,
    jql: epicsJql,
    fields: baseFields,
    pageSize,
  });

  // Normalize epics
  const epics = epicIssues.map((e) => normIssue(e));
  const epicKeys = epics.map((e) => e.key);
  const epicKeySet = new Set(epicKeys);

  // 2) Get direct children of the epics via parent IN (forward-compatible)
  let childIssues = [];
  const childrenByEpic = new Map(epicKeys.map((k) => [k, []]));
  if (epicKeys.length) {
    const chunk = (arr, n = 50) =>
      arr.reduce((a, _, i) => (i % n ? a : [...a, arr.slice(i, i + n)]), []);
    const epicChunks = chunk(epicKeys, 50);
    const orClauses = epicChunks.map(
      (ks) => `parent in (${ks.map((k) => `"${k}"`).join(",")})`
    );
    const childrenJql = `project = "${projectKeyOrId}" AND (${orClauses.join(
      " OR "
    )}) ORDER BY Rank`;
    const { issues: children } = await jqlSearchPaged({
      baseUrl,
      headers,
      jql: childrenJql,
      fields: baseFields,
      pageSize,
    });
    childIssues = children.map((i) => normIssue(i));
    for (const c of childIssues) {
      const p = c.parentKey;
      if (p && epicKeySet.has(p)) childrenByEpic.get(p).push(c);
    }
  }

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
        fields: baseFields,
        pageSize,
      });
      allSubtasks.push(...issues);
    }
    const normalizedSubs = allSubtasks.map((s) => normIssue(s));
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
