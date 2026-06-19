# File System

> Client filesystem access methods

The filesystem methods allow Agents to read and write text files within the Client's environment. These methods enable Agents to access unsaved editor state and allow Clients to track file modifications made during agent execution.

## Checking Support

Before attempting to use filesystem methods, Agents **MUST** verify that the Client supports these capabilities by checking the [Client Capabilities](./acp-initialization#client-capabilities) field in the `initialize` response:

```json
{
  "jsonrpc": "2.0",
  "id": 0,
  "result": {
    "protocolVersion": 1,
    "clientCapabilities": {
      "fs": {
        "readTextFile": true,
        "writeTextFile": true
      }
    }
  }
}
```

If `readTextFile` or `writeTextFile` is `false` or not present, the Agent **MUST NOT** attempt to call the corresponding filesystem method.

## Reading Files

The `fs/read_text_file` method allows Agents to read text file contents from the Client's filesystem, including unsaved changes in the editor.

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "fs/read_text_file",
  "params": {
    "sessionId": "sess_abc123def456",
    "path": "/home/user/project/src/main.py",
    "line": 10,
    "limit": 50
  }
}
```

- **`sessionId`** (required `SessionId`): The [Session ID](./acp-session-setup#session-id) for this request
- **`path`** (required `string`): Absolute path to the file to read
- **`line`** (`number`): Optional line number to start reading from (1-based)
- **`limit`** (`number`): Optional maximum number of lines to read

The Client responds with the file contents:

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "content": "def hello_world():\n    print('Hello, world!')\n"
  }
}
```

## Writing Files

The `fs/write_text_file` method allows Agents to write or update text files in the Client's filesystem.

```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "method": "fs/write_text_file",
  "params": {
    "sessionId": "sess_abc123def456",
    "path": "/home/user/project/config.json",
    "content": "{\n  \"debug\": true,\n  \"version\": \"1.0.0\"\n}"
  }
}
```

- **`sessionId`** (required `SessionId`): The [Session ID](./acp-session-setup#session-id) for this request
- **`path`** (required `string`): Absolute path to the file to write. The Client **MUST** create the file if it doesn't exist.
- **`content`** (required `string`): The text content to write to the file

The Client responds with an empty result on success:

```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "result": null
}
```

## Implementation Notes (EraGear)

- Unsaved editor state is synchronized via `code.syncEditorBuffer` and stored per session as canonical absolute paths.
- `fs/read_text_file` prefers synchronized editor buffers over on-disk content.
- `fs/write_text_file` emits a `file_modified` broadcast event so connected clients can refresh workspace state.

---

> To find navigation and other pages in this documentation, fetch the llms.txt file at: https://agentclientprotocol.com/llms.txt
