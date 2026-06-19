# Tool Calls

> How Agents report tool call execution

Tool calls represent actions that language models request Agents to perform during a [prompt turn](./acp-prompt-turn). When an LLM determines it needs to interact with external systems—like reading files, running code, or fetching data—it generates tool calls that the Agent executes on its behalf.

Agents report tool calls through [`session/update`](./acp-prompt-turn#3-agent-reports-output) notifications, allowing Clients to display real-time progress and results to users.

While Agents handle the actual execution, they may leverage Client capabilities like [permission requests](#requesting-permission) or [file system access](./acp-file-system) to provide a richer, more integrated experience.

## Creating

When the language model requests a tool invocation, the Agent **SHOULD** report it to the Client:

```json
{
  "jsonrpc": "2.0",
  "method": "session/update",
  "params": {
    "sessionId": "sess_abc123def456",
    "update": {
      "sessionUpdate": "tool_call",
      "toolCallId": "call_001",
      "title": "Reading configuration file",
      "kind": "read",
      "status": "pending"
    }
  }
}
```

- **`toolCallId`** (required `ToolCallId`): A unique identifier for this tool call within the session
- **`title`** (required `string`): A human-readable title describing what the tool is doing
- **`kind`** (`ToolKind`): The category of tool being invoked. Tool kinds help Clients choose appropriate icons and optimize how they display tool execution progress.
  * `read` - Reading files or data
  * `edit` - Modifying files or content
  * `delete` - Removing files or data
  * `move` - Moving or renaming files
  * `search` - Searching for information
  * `execute` - Running commands or code
  * `think` - Internal reasoning or planning
  * `fetch` - Retrieving external data
  * `other` - Other tool types (default)
- **`status`** (`ToolCallStatus`): The current [execution status](#status) (defaults to `pending`)
- **`content`** (`ToolCallContent[]`): [Content produced](#content) by the tool call
- **`locations`** (`ToolCallLocation[]`): [File locations](#following-the-agent) affected by this tool call
- **`rawInput`** (`object`): The raw input parameters sent to the tool
- **`rawOutput`** (`object`): The raw output returned by the tool

## Updating

As tools execute, Agents send updates to report progress and results.

Updates use the `session/update` notification with `tool_call_update`:

```json
{
  "jsonrpc": "2.0",
  "method": "session/update",
  "params": {
    "sessionId": "sess_abc123def456",
    "update": {
      "sessionUpdate": "tool_call_update",
      "toolCallId": "call_001",
      "status": "in_progress",
      "content": [
        {
          "type": "content",
          "content": {
            "type": "text",
            "text": "Found 3 configuration files..."
          }
        }
      ]
    }
  }
}
```

All fields except `toolCallId` are optional in updates. Only the fields being changed need to be included.

For `apps/server`, if a `tool_call_update` arrives before an initial `tool_call`,
the runtime will synthesize an in-memory tool call from the update so UI clients
still receive a renderable `ToolUIPart`.

## Requesting Permission

The Agent **MAY** request permission from the user before executing a tool call by calling the `session/request_permission` method:

```json
{
  "jsonrpc": "2.0",
  "id": 5,
  "method": "session/request_permission",
  "params": {
    "sessionId": "sess_abc123def456",
    "toolCall": {
      "toolCallId": "call_001"
    },
    "options": [
      {
        "optionId": "allow-once",
        "name": "Allow once",
        "kind": "allow_once"
      },
      {
        "optionId": "reject-once",
        "name": "Reject",
        "kind": "reject_once"
      }
    ]
  }
}
```

- **`sessionId`** (required `SessionId`): The session ID for this request
- **`toolCall`** (required `ToolCallUpdate`): The tool call update containing details about the operation
- **`options`** (required `PermissionOption[]`): Available [permission options](#permission-options) for the user to choose from

The Client responds with the user's decision:

```json
{
  "jsonrpc": "2.0",
  "id": 5,
  "result": {
    "outcome": {
      "outcome": "selected",
      "optionId": "allow-once"
    }
  }
}
```

Clients **MAY** automatically allow or reject permission requests according to the user settings.

If the current prompt turn gets [cancelled](./acp-prompt-turn#cancellation), the Client **MUST** respond with the `"cancelled"` outcome:

```json
{
  "jsonrpc": "2.0",
  "id": 5,
  "result": {
    "outcome": {
      "outcome": "cancelled"
    }
  }
}
```

- **`outcome`** (required `RequestPermissionOutcome`): The user's decision, either:
  - `cancelled` - The [prompt turn was cancelled](./acp-prompt-turn#cancellation)
  - `selected` with an `optionId` - The ID of the selected permission option

For `apps/server` web clients, cancellation is done via `cancelPrompt({ chatId })`.
`respondToPermissionRequest` maps to selected options only and is not the path to
emit ACP `cancelled` outcome.

### Permission Options

Each permission option provided to the Client contains:

- **`optionId`** (required `string`): Unique identifier for this option
- **`name`** (required `string`): Human-readable label to display to the user
- **`kind`** (required `PermissionOptionKind`): A hint to help Clients choose appropriate icons and UI treatment for each option.
  * `allow_once` - Allow this operation only this time
  * `allow_always` - Allow this operation and remember the choice
  * `reject_once` - Reject this operation only this time
  * `reject_always` - Reject this operation and remember the choice

## Status

Tool calls progress through different statuses during their lifecycle:

- **`pending`**: The tool call hasn't started running yet because the input is either streaming or awaiting approval
- **`in_progress`**: The tool call is currently running
- **`completed`**: The tool call completed successfully
- **`failed`**: The tool call failed with an error

## Content

Tool calls can produce different types of content:

### Regular Content

Standard [content blocks](./acp-content) like text, images, or resources:

```json
{
  "type": "content",
  "content": {
    "type": "text",
    "text": "Analysis complete. Found 3 issues."
  }
}
```

### Diffs

File modifications shown as diffs:

```json
{
  "type": "diff",
  "path": "/home/user/project/src/config.json",
  "oldText": "{\n  \"debug\": false\n}",
  "newText": "{\n  \"debug\": true\n}"
}
```

- **`path`** (required `string`): The absolute file path being modified
- **`oldText`** (`string`): The original content (null for new files)
- **`newText`** (required `string`): The new content after modification

### Terminals

Live terminal output from command execution:

```json
{
  "type": "terminal",
  "terminalId": "term_xyz789"
}
```

- **`terminalId`** (required `string`): The ID of a terminal created with `terminal/create`

When a terminal is embedded in a tool call, the Client displays live output as it's generated and continues to display it even after the terminal is released.

> 💻 [Learn more about Terminals](./acp-terminal)

## Following the Agent

Tool calls can report file locations they're working with, enabling Clients to implement "follow-along" features that track which files the Agent is accessing or modifying in real-time.

```json
{
  "path": "/home/user/project/src/main.py",
  "line": 42
}
```

- **`path`** (required `string`): The absolute file path being accessed or modified
- **`line`** (`number`): Optional line number within the file

---

> To find navigation and other pages in this documentation, fetch the llms.txt file at: https://agentclientprotocol.com/llms.txt
