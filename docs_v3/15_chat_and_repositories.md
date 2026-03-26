# ControlFile – Chat & Repository Indexing

---

## Overview

ControlFile includes a code repository Q&A system. Repositories (GitHub) can be indexed, then queried via natural language chat. The two domains are tightly coupled:

- **Repositories domain** (`/repositories/`): manages indexing lifecycle
- **Chat domain** (`/api/chat/`, `/v1/chat/`): queries indexed repositories

---

## Route Prefixes

| Domain | Prefixes | Note |
|---|---|---|
| Repositories | `/repositories/`, `/v1/repositories/` | **No `/api/`** prefix |
| Chat | `/api/chat/`, `/v1/chat/` | Standard dual prefix |

---

## Repository Indexing

### Repository ID Format

All repository references use a structured ID: `github:{owner}:{repo}`

```
github:octocat:Hello-World
github:microsoft:TypeScript
```

### Repository Lifecycle States

```
idle      →  Not yet indexed (initial state)
indexing  →  Indexing in progress (async, cannot be queried)
ready     →  Indexed and queryable
error     →  Indexing failed
```

---

### POST /repositories/index

Start indexing a GitHub repository. Idempotent with SHA-based change detection.

**Auth:** Required (Firebase ID Token)
**Backend:** `POST /v1/repositories/index` (no `/api/`)

**Request:**
```json
{
  "repositoryId": "github:owner:repo",
  "owner": "owner",
  "repo": "repo-name",
  "accessToken": null,
  "uid": "firebase-uid",
  "branch": null,
  "force": false
}
```

| Field | Required | Description |
|---|---|---|
| `repositoryId` | Conditional | Format `github:owner:repo`. If omitted, `owner` + `repo` are required |
| `owner` | Conditional | GitHub owner (required if no `repositoryId`) |
| `repo` | Conditional | GitHub repo name (required if no `repositoryId`) |
| `uid` | Yes | Firebase UID of requesting user |
| `accessToken` | No | GitHub access token for private repos. `null` for public repos |
| `branch` | No | Branch to index. `null` = default branch |
| `force` | No | `true` = force re-index even if SHA unchanged |

**Behavior:**
- If state is `idle`: starts indexing
- If state is `indexing`: returns current state (does not start another)
- If state is `ready`: checks commit SHA; only re-indexes if SHA changed or `force: true`

**Response (indexing started `200`):**
```json
{
  "status": "indexing",
  "repositoryId": "github:owner:repo",
  "message": "Indexación iniciada"
}
```

**Response (already indexing `200`):**
```json
{
  "status": "indexing",
  "repositoryId": "github:owner:repo",
  "message": "Ya está indexando"
}
```

**Response (up to date `200`):**
```json
{
  "status": "ready",
  "repositoryId": "github:owner:repo",
  "message": "Repositorio ya está indexado y actualizado"
}
```

---

### GET /repositories/status/:repositoryId

Get indexing status of a repository.

**Auth:** Required
**Backend:** `GET /v1/repositories/status/:repositoryId`

**Response `200`:**
```json
{
  "repositoryId": "github:owner:repo",
  "status": "ready",
  "owner": "owner",
  "repo": "repo-name",
  "branch": "main",
  "indexedAt": "2026-03-20T10:00:00.000Z",
  "commitSha": "abc123"
}
```

**Errors:** `400` invalid `repositoryId` format · `404` repository not found

---

## Chat Queries

### POST /api/chat/query

Query an indexed repository in natural language.

**Auth:** Required
**Backend:** `POST /v1/chat/query`

**Request:**
```json
{
  "repositoryId": "github:owner:repo",
  "question": "How does authentication work?",
  "conversationId": "conv-abc123"
}
```

| Field | Required | Description |
|---|---|---|
| `repositoryId` | Yes | Format `github:owner:repo` |
| `question` | Yes | Natural language question (non-empty string) |
| `conversationId` | No | Conversation context ID for multi-turn queries |

**Response `200` (repository ready):**
```json
{
  "response": "Authentication uses Firebase ID tokens...",
  "conversationId": "conv-abc123",
  "sources": [
    { "path": "src/middleware/auth.js", "lines": [10, 25] },
    { "path": "docs/auth.md", "lines": [1, 50] }
  ]
}
```

**Response `202` (repository indexing):**
```json
{
  "status": "indexing",
  "message": "El repositorio aún se está indexando, intente nuevamente en unos minutos",
  "estimatedTime": 30
}
```

**Response `400` (not indexed):**
```json
{
  "status": "idle",
  "message": "El repositorio no ha sido indexado. Use POST /repositories/index primero"
}
```

**Errors:**

| Status | Meaning |
|---|---|
| `202` | Still indexing — retry later |
| `400` | Repository is idle or in error state — must be indexed first |
| `400` | Invalid `repositoryId` format |
| `401` | Missing or invalid Firebase token |
| `500` | Internal error |

---

## Integration Pattern

```javascript
// 1. Start indexing
const indexRes = await fetch('/v1/repositories/index', {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ owner: 'myorg', repo: 'myrepo', uid }),
});

// 2. Poll status until ready
let status = 'indexing';
while (status === 'indexing') {
  await sleep(5000);
  const statusRes = await fetch(`/v1/repositories/status/github:myorg:myrepo`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await statusRes.json();
  status = data.status;
}

// 3. Query
const chatRes = await fetch('/api/chat/query', {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    repositoryId: 'github:myorg:myrepo',
    question: 'How does the upload flow work?'
  }),
});
const { response, sources } = await chatRes.json();
```
