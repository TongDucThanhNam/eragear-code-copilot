# Schema

> Schema definitions for the Agent Client Protocol

## Agent

Defines the interface that all ACP-compliant agents must implement.

Agents are programs that use generative AI to autonomously modify code. They handle
requests from clients and execute tasks using language models and tools.

### `authenticate`

Authenticates the client using the specified authentication method.

Called when the agent requires authentication before allowing session creation.
The client provides the authentication method ID that was advertised during initialization.

After successful authentication, the client can proceed to create sessions with
`new_session` without receiving an `auth_required` error.

See protocol docs: [Initialization](https://agentclientprotocol.com/protocol/initialization)

#### `AuthenticateRequest`

Request parameters for the authenticate method.

Specifies which authentication method to use.

**Type:** Object

**Properties:**

- **`_meta`** (`object | null`):
  The \_meta property is reserved by ACP to allow clients and agents to attach additional
  metadata to their interactions. Implementations MUST NOT make assumptions about values at
  these keys.

  See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)


- **`methodId`** (required `string`):
  The ID of the authentication method to use.
  Must be one of the methods advertised in the initialize response.


#### `AuthenticateResponse`

Response to the `authenticate` method.

**Type:** Object

**Properties:**

- **`_meta`** (`object | null`):
  The \_meta property is reserved by ACP to allow clients and agents to attach additional
  metadata to their interactions. Implementations MUST NOT make assumptions about values at
  these keys.

  See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)


### `initialize`

Establishes the connection with a client and negotiates protocol capabilities.

This method is called once at the beginning of the connection to:

* Negotiate the protocol version to use
* Exchange capability information between client and agent
* Determine available authentication methods

The agent should respond with its supported protocol version and capabilities.

See protocol docs: [Initialization](https://agentclientprotocol.com/protocol/initialization)

#### `InitializeRequest`

Request parameters for the initialize method.

Sent by the client to establish connection and negotiate capabilities.

See protocol docs: [Initialization](https://agentclientprotocol.com/protocol/initialization)

**Type:** Object

**Properties:**

- **`_meta`** (`object | null`):
  The \_meta property is reserved by ACP to allow clients and agents to attach additional
  metadata to their interactions. Implementations MUST NOT make assumptions about values at
  these keys.

  See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)


- **`clientCapabilities`** (`ClientCapabilities`):
  Capabilities supported by the client.

  * Default: `{"fs":{"readTextFile":false,"writeTextFile":false},"terminal":false}`


- **`clientInfo`** (`Implementation | null`):
  Information about the Client name and version sent to the Agent.

  Note: in future versions of the protocol, this will be required.


- **`protocolVersion`** (required `ProtocolVersion`):
  The latest protocol version supported by the client.


#### `InitializeResponse`

Response to the `initialize` method.

Contains the negotiated protocol version and agent capabilities.

See protocol docs: [Initialization](https://agentclientprotocol.com/protocol/initialization)

**Type:** Object

**Properties:**

- **`_meta`** (`object | null`):
  The \_meta property is reserved by ACP to allow clients and agents to attach additional
  metadata to their interactions. Implementations MUST NOT make assumptions about values at
  these keys.

  See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)


- **`agentCapabilities`** (`AgentCapabilities`):
  Capabilities supported by the agent.

  * Default: `{"loadSession":false,"mcpCapabilities":{"http":false,"sse":false},"promptCapabilities":{"audio":false,"embeddedContext":false,"image":false},"sessionCapabilities":{}}`


- **`agentInfo`** (`Implementation | null`):
  Information about the Agent name and version sent to the Client.

  Note: in future versions of the protocol, this will be required.


- **`authMethods`** (`AuthMethod[]`):
  Authentication methods supported by the agent.

  * Default: `[]`


- **`protocolVersion`** (required `ProtocolVersion`):
  The protocol version the client specified if supported by the agent,
  or the latest protocol version supported by the agent.

  The client should disconnect, if it doesn't support this version.


### `session/cancel`

Cancels ongoing operations for a session.

This is a notification sent by the client to cancel an ongoing prompt turn.

Upon receiving this notification, the Agent SHOULD:

* Stop all language model requests as soon as possible
* Abort all tool call invocations in progress
* Send any pending `session/update` notifications
* Respond to the original `session/prompt` request with `StopReason::Cancelled`

See protocol docs: [Cancellation](https://agentclientprotocol.com/protocol/prompt-turn#cancellation)

#### `CancelNotification`

Notification to cancel ongoing operations for a session.

See protocol docs: [Cancellation](https://agentclientprotocol.com/protocol/prompt-turn#cancellation)

**Type:** Object

**Properties:**

- **`_meta`** (`object | null`):
  The \_meta property is reserved by ACP to allow clients and agents to attach additional
  metadata to their interactions. Implementations MUST NOT make assumptions about values at
  these keys.

  See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)


- **`sessionId`** (required `SessionId`):
  The ID of the session to cancel operations for.


### `session/load`

Loads an existing session to resume a previous conversation.

This method is only available if the agent advertises the `loadSession` capability.

The agent should:

* Restore the session context and conversation history
* Connect to the specified MCP servers
* Stream the entire conversation history back to the client via notifications

See protocol docs: [Loading Sessions](https://agentclientprotocol.com/protocol/session-setup#loading-sessions)

#### `LoadSessionRequest`

Request parameters for loading an existing session.

Only available if the Agent supports the `loadSession` capability.

See protocol docs: [Loading Sessions](https://agentclientprotocol.com/protocol/session-setup#loading-sessions)

**Type:** Object

**Properties:**

- **`_meta`** (`object | null`):
  The \_meta property is reserved by ACP to allow clients and agents to attach additional
  metadata to their interactions. Implementations MUST NOT make assumptions about values at
  these keys.

  See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)


- **`cwd`** (required `string`):
  The working directory for this session.


- **`mcpServers`** (required `McpServer[]`):
  List of MCP servers to connect to for this session.


- **`sessionId`** (required `SessionId`):
  The ID of the session to load.


#### `LoadSessionResponse`

Response from loading an existing session.

**Type:** Object

**Properties:**

- **`_meta`** (`object | null`):
  The \_meta property is reserved by ACP to allow clients and agents to attach additional
  metadata to their interactions. Implementations MUST NOT make assumptions about values at
  these keys.

  See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)


- **`modes`** (`SessionModeState | null`):
  Initial mode state if supported by the Agent

  See protocol docs: [Session Modes](https://agentclientprotocol.com/protocol/session-modes)


### `session/new`

Creates a new conversation session with the agent.

Sessions represent independent conversation contexts with their own history and state.

The agent should:

* Create a new session context
* Connect to any specified MCP servers
* Return a unique session ID for future requests

May return an `auth_required` error if the agent requires authentication.

See protocol docs: [Session Setup](https://agentclientprotocol.com/protocol/session-setup)

#### `NewSessionRequest`

Request parameters for creating a new session.

See protocol docs: [Creating a Session](https://agentclientprotocol.com/protocol/session-setup#creating-a-session)

**Type:** Object

**Properties:**

- **`_meta`** (`object | null`):
  The \_meta property is reserved by ACP to allow clients and agents to attach additional
  metadata to their interactions. Implementations MUST NOT make assumptions about values at
  these keys.

  See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)


- **`cwd`** (required `string`):
  The working directory for this session. Must be an absolute path.


- **`mcpServers`** (required `McpServer[]`):
  List of MCP (Model Context Protocol) servers the agent should connect to.


#### `NewSessionResponse`

Response from creating a new session.

See protocol docs: [Creating a Session](https://agentclientprotocol.com/protocol/session-setup#creating-a-session)

**Type:** Object

**Properties:**

- **`_meta`** (`object | null`):
  The \_meta property is reserved by ACP to allow clients and agents to attach additional
  metadata to their interactions. Implementations MUST NOT make assumptions about values at
  these keys.

  See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)


- **`modes`** (`SessionModeState | null`):
  Initial mode state if supported by the Agent

  See protocol docs: [Session Modes](https://agentclientprotocol.com/protocol/session-modes)


- **`sessionId`** (required `SessionId`):
  Unique identifier for the created session.

  Used in all subsequent requests for this conversation.


### `session/prompt`

Processes a user prompt within a session.

This method handles the whole lifecycle of a prompt:

* Receives user messages with optional context (files, images, etc.)
* Processes the prompt using language models
* Reports language model content and tool calls to the Clients
* Requests permission to run tools
* Executes any requested tool calls
* Returns when the turn is complete with a stop reason

See protocol docs: [Prompt Turn](https://agentclientprotocol.com/protocol/prompt-turn)

#### `PromptRequest`

Request parameters for sending a user prompt to the agent.

Contains the user's message and any additional context.

See protocol docs: [User Message](https://agentclientprotocol.com/protocol/prompt-turn#1-user-message)

**Type:** Object

**Properties:**

- **`_meta`** (`object | null`):
  The \_meta property is reserved by ACP to allow clients and agents to attach additional
  metadata to their interactions. Implementations MUST NOT make assumptions about values at
  these keys.

  See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)


- **`prompt`** (required `ContentBlock[]`):
  The blocks of content that compose the user's message.

  As a baseline, the Agent MUST support `ContentBlock::Text` and `ContentBlock::ResourceLink`,
  while other variants are optionally enabled via `PromptCapabilities`.

  The Client MUST adapt its interface according to `PromptCapabilities`.

  The client MAY include referenced pieces of context as either
  `ContentBlock::Resource` or `ContentBlock::ResourceLink`.

  When available, `ContentBlock::Resource` is preferred
  as it avoids extra round-trips and allows the message to include
  pieces of context from sources the agent may not have access to.


- **`sessionId`** (required `SessionId`):
  The ID of the session to send this user message to


#### `PromptResponse`

Response from processing a user prompt.

See protocol docs: [Check for Completion](https://agentclientprotocol.com/protocol/prompt-turn#4-check-for-completion)

**Type:** Object

**Properties:**

- **`_meta`** (`object | null`):
  The \_meta property is reserved by ACP to allow clients and agents to attach additional
  metadata to their interactions. Implementations MUST NOT make assumptions about values at
  these keys.

  See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)


- **`stopReason`** (required `StopReason`):
  Indicates why the agent stopped processing the turn.


### `session/set\_mode`

Sets the current mode for a session.

Allows switching between different agent modes (e.g., "ask", "architect", "code")
that affect system prompts, tool availability, and permission behaviors.

The mode must be one of the modes advertised in `availableModes` during session
creation or loading. Agents may also change modes autonomously and notify the
client via `current_mode_update` notifications.

This method can be called at any time during a session, whether the Agent is
idle or actively generating a response.

See protocol docs: [Session Modes](https://agentclientprotocol.com/protocol/session-modes)

#### `SetSessionModeRequest`

Request parameters for setting a session mode.

**Type:** Object

**Properties:**

- **`_meta`** (`object | null`):
  The \_meta property is reserved by ACP to allow clients and agents to attach additional
  metadata to their interactions. Implementations MUST NOT make assumptions about values at
  these keys.

  See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)


- **`modeId`** (required `SessionModeId`):
  The ID of the mode to set.


- **`sessionId`** (required `SessionId`):
  The ID of the session to set the mode for.


#### `SetSessionModeResponse`

Response to `session/set_mode` method.

**Type:** Object

**Properties:**

- **`_meta`** (object | null): 
## Client

Defines the interface that ACP-compliant clients must implement.

Clients are typically code editors (IDEs, text editors) that provide the interface
between users and AI agents. They manage the environment, handle user interactions,
and control access to resources.


### `fs/read\_text\_file`

Reads content from a text file in the client's file system.

Only available if the client advertises the `fs.readTextFile` capability.
Allows the agent to access file contents within the client's environment.

See protocol docs: [Client](https://agentclientprotocol.com/protocol/overview#client)

#### `ReadTextFileRequest`

Request to read content from a text file.

Only available if the client supports the `fs.readTextFile` capability.

**Type:** Object

**Properties:**

- **`_meta`** (`object | null`):
  The \_meta property is reserved by ACP to allow clients and agents to attach additional
  metadata to their interactions. Implementations MUST NOT make assumptions about values at
  these keys.

  See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)


- **`limit`** (`integer | null`):
  Maximum number of lines to read.

  * Minimum: `0`


- **`line`** (`integer | null`):
  Line number to start reading from (1-based).

  * Minimum: `0`


- **`path`** (required `string`):
  Absolute path to the file to read.


- **`sessionId`** (required `SessionId`):
  The session ID for this request.


#### `ReadTextFileResponse`

Response containing the contents of a text file.

**Type:** Object

**Properties:**

- **`_meta`** (`object | null`):
  The \_meta property is reserved by ACP to allow clients and agents to attach additional
  metadata to their interactions. Implementations MUST NOT make assumptions about values at
  these keys.

  See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)


- **`content`** (required `string`): 
### `fs/write\_text\_file`

Writes content to a text file in the client's file system.

Only available if the client advertises the `fs.writeTextFile` capability.
Allows the agent to create or modify files within the client's environment.

See protocol docs: [Client](https://agentclientprotocol.com/protocol/overview#client)

#### `WriteTextFileRequest`

Request to write content to a text file.

Only available if the client supports the `fs.writeTextFile` capability.

**Type:** Object

**Properties:**

- **`_meta`** (`object | null`):
  The \_meta property is reserved by ACP to allow clients and agents to attach additional
  metadata to their interactions. Implementations MUST NOT make assumptions about values at
  these keys.

  See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)


- **`content`** (required `string`):
  The text content to write to the file.


- **`path`** (required `string`):
  Absolute path to the file to write.


- **`sessionId`** (required `SessionId`):
  The session ID for this request.


#### `WriteTextFileResponse`

Response to `fs/write_text_file`

**Type:** Object

**Properties:**

- **`_meta`** (`object | null`):
  The \_meta property is reserved by ACP to allow clients and agents to attach additional
  metadata to their interactions. Implementations MUST NOT make assumptions about values at
  these keys.

  See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)


### `session/request\_permission`

Requests permission from the user for a tool call operation.

Called by the agent when it needs user authorization before executing
a potentially sensitive operation. The client should present the options
to the user and return their decision.

If the client cancels the prompt turn via `session/cancel`, it MUST
respond to this request with `RequestPermissionOutcome::Cancelled`.

See protocol docs: [Requesting Permission](https://agentclientprotocol.com/protocol/tool-calls#requesting-permission)

#### `RequestPermissionRequest`

Request for user permission to execute a tool call.

Sent when the agent needs authorization before performing a sensitive operation.

See protocol docs: [Requesting Permission](https://agentclientprotocol.com/protocol/tool-calls#requesting-permission)

**Type:** Object

**Properties:**

- **`_meta`** (`object | null`):
  The \_meta property is reserved by ACP to allow clients and agents to attach additional
  metadata to their interactions. Implementations MUST NOT make assumptions about values at
  these keys.

  See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)


- **`options`** (required `PermissionOption[]`):
  Available permission options for the user to choose from.


- **`sessionId`** (required `SessionId`):
  The session ID for this request.


- **`toolCall`** (required `ToolCallUpdate`):
  Details about the tool call requiring permission.


#### `RequestPermissionResponse`

Response to a permission request.

**Type:** Object

**Properties:**

- **`_meta`** (`object | null`):
  The \_meta property is reserved by ACP to allow clients and agents to attach additional
  metadata to their interactions. Implementations MUST NOT make assumptions about values at
  these keys.

  See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)


- **`outcome`** (required `RequestPermissionOutcome`):
  The user's decision on the permission request.


### `session/update`

Handles session update notifications from the agent.

This is a notification endpoint (no response expected) that receives
real-time updates about session progress, including message chunks,
tool calls, and execution plans.

Note: Clients SHOULD continue accepting tool call updates even after
sending a `session/cancel` notification, as the agent may send final
updates before responding with the cancelled stop reason.

See protocol docs: [Agent Reports Output](https://agentclientprotocol.com/protocol/prompt-turn#3-agent-reports-output)

#### `SessionNotification`

Notification containing a session update from the agent.

Used to stream real-time progress and results during prompt processing.

See protocol docs: [Agent Reports Output](https://agentclientprotocol.com/protocol/prompt-turn#3-agent-reports-output)

**Type:** Object

**Properties:**

- **`_meta`** (`object | null`):
  The \_meta property is reserved by ACP to allow clients and agents to attach additional
  metadata to their interactions. Implementations MUST NOT make assumptions about values at
  these keys.

  See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)


- **`sessionId`** (required `SessionId`):
  The ID of the session this update pertains to.


- **`update`** (required `SessionUpdate`):
  The actual update content.


### `terminal/create`

Executes a command in a new terminal

Only available if the `terminal` Client capability is set to `true`.

Returns a `TerminalId` that can be used with other terminal methods
to get the current output, wait for exit, and kill the command.

The `TerminalId` can also be used to embed the terminal in a tool call
by using the `ToolCallContent::Terminal` variant.

The Agent is responsible for releasing the terminal by using the `terminal/release`
method.

See protocol docs: [Terminals](https://agentclientprotocol.com/protocol/terminals)

#### `CreateTerminalRequest`

Request to create a new terminal and execute a command.

**Type:** Object

**Properties:**

- **`_meta`** (`object | null`):
  The \_meta property is reserved by ACP to allow clients and agents to attach additional
  metadata to their interactions. Implementations MUST NOT make assumptions about values at
  these keys.

  See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)


- **`args`** (`string"[]`):
  Array of command arguments.


- **`command`** (required `string`):
  The command to execute.


- **`cwd`** (`string | null`):
  Working directory for the command (absolute path).


- **`env`** (`EnvVariable[]`):
  Environment variables for the command.


- **`outputByteLimit`** (`integer | null`):
  Maximum number of output bytes to retain.

  When the limit is exceeded, the Client truncates from the beginning of the output
  to stay within the limit.

  The Client MUST ensure truncation happens at a character boundary to maintain valid
  string output, even if this means the retained output is slightly less than the
  specified limit.

  * Minimum: `0`


- **`sessionId`** (required `SessionId`):
  The session ID for this request.


#### `CreateTerminalResponse`

Response containing the ID of the created terminal.

**Type:** Object

**Properties:**

- **`_meta`** (`object | null`):
  The \_meta property is reserved by ACP to allow clients and agents to attach additional
  metadata to their interactions. Implementations MUST NOT make assumptions about values at
  these keys.

  See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)


- **`terminalId`** (required `string`):
  The unique identifier for the created terminal.


### `terminal/kill`

Kills the terminal command without releasing the terminal

While `terminal/release` will also kill the command, this method will keep
the `TerminalId` valid so it can be used with other methods.

This method can be helpful when implementing command timeouts which terminate
the command as soon as elapsed, and then get the final output so it can be sent
to the model.

Note: `terminal/release` when `TerminalId` is no longer needed.

See protocol docs: [Terminals](https://agentclientprotocol.com/protocol/terminals)

#### `KillTerminalCommandRequest`

Request to kill a terminal command without releasing the terminal.

**Type:** Object

**Properties:**

- **`_meta`** (`object | null`):
  The \_meta property is reserved by ACP to allow clients and agents to attach additional
  metadata to their interactions. Implementations MUST NOT make assumptions about values at
  these keys.

  See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)


- **`sessionId`** (required `SessionId`):
  The session ID for this request.


- **`terminalId`** (required `string`):
  The ID of the terminal to kill.


#### `KillTerminalCommandResponse`

Response to terminal/kill command method

**Type:** Object

**Properties:**

- **`_meta`** (`object | null`):
  The \_meta property is reserved by ACP to allow clients and agents to attach additional
  metadata to their interactions. Implementations MUST NOT make assumptions about values at
  these keys.

  See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)


### `terminal/output`

Gets the terminal output and exit status

Returns the current content in the terminal without waiting for the command to exit.
If the command has already exited, the exit status is included.

See protocol docs: [Terminals](https://agentclientprotocol.com/protocol/terminals)

#### `TerminalOutputRequest`

Request to get the current output and status of a terminal.

**Type:** Object

**Properties:**

- **`_meta`** (`object | null`):
  The \_meta property is reserved by ACP to allow clients and agents to attach additional
  metadata to their interactions. Implementations MUST NOT make assumptions about values at
  these keys.

  See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)


- **`sessionId`** (required `SessionId`):
  The session ID for this request.


- **`terminalId`** (required `string`):
  The ID of the terminal to get output from.


#### `TerminalOutputResponse`

Response containing the terminal output and exit status.

**Type:** Object

**Properties:**

- **`_meta`** (`object | null`):
  The \_meta property is reserved by ACP to allow clients and agents to attach additional
  metadata to their interactions. Implementations MUST NOT make assumptions about values at
  these keys.

  See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)


- **`exitStatus`** (`TerminalExitStatus | null`):
  Exit status if the command has completed.


- **`output`** (required `string`):
  The terminal output captured so far.


- **`truncated`** (required `boolean`):
  Whether the output was truncated due to byte limits.


### `terminal/release`

Releases a terminal

The command is killed if it hasn't exited yet. Use `terminal/wait_for_exit`
to wait for the command to exit before releasing the terminal.

After release, the `TerminalId` can no longer be used with other `terminal/*` methods,
but tool calls that already contain it, continue to display its output.

The `terminal/kill` method can be used to terminate the command without releasing
the terminal, allowing the Agent to call `terminal/output` and other methods.

See protocol docs: [Terminals](https://agentclientprotocol.com/protocol/terminals)

#### `ReleaseTerminalRequest`

Request to release a terminal and free its resources.

**Type:** Object

**Properties:**

- **`_meta`** (`object | null`):
  The \_meta property is reserved by ACP to allow clients and agents to attach additional
  metadata to their interactions. Implementations MUST NOT make assumptions about values at
  these keys.

  See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)


- **`sessionId`** (required `SessionId`):
  The session ID for this request.


- **`terminalId`** (required `string`):
  The ID of the terminal to release.


#### `ReleaseTerminalResponse`

Response to terminal/release method

**Type:** Object

**Properties:**

- **`_meta`** (`object | null`):
  The \_meta property is reserved by ACP to allow clients and agents to attach additional
  metadata to their interactions. Implementations MUST NOT make assumptions about values at
  these keys.

  See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)


### `terminal/wait\_for\_exit`

Waits for the terminal command to exit and return its exit status

See protocol docs: [Terminals](https://agentclientprotocol.com/protocol/terminals)

#### `WaitForTerminalExitRequest`

Request to wait for a terminal command to exit.

**Type:** Object

**Properties:**

- **`_meta`** (`object | null`):
  The \_meta property is reserved by ACP to allow clients and agents to attach additional
  metadata to their interactions. Implementations MUST NOT make assumptions about values at
  these keys.

  See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)


- **`sessionId`** (required `SessionId`):
  The session ID for this request.


- **`terminalId`** (required `string`):
  The ID of the terminal to wait for.


#### `WaitForTerminalExitResponse`

Response containing the exit status of a terminal command.

**Type:** Object

**Properties:**

- **`_meta`** (`object | null`):
  The \_meta property is reserved by ACP to allow clients and agents to attach additional
  metadata to their interactions. Implementations MUST NOT make assumptions about values at
  these keys.

  See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)


- **`exitCode`** (`integer | null`):
  The process exit code (may be null if terminated by signal).

  * Minimum: `0`


- **`signal`** (`string | null`):
  The signal that terminated the process (may be null if exited normally).


## `AgentCapabilities`

Capabilities supported by the agent.

Advertised during initialization to inform the client about
available features and content types.

See protocol docs: [Agent Capabilities](https://agentclientprotocol.com/protocol/initialization#agent-capabilities)

**Type:** Object

**Properties:**

- **`_meta`** (`object | null`):
  The \_meta property is reserved by ACP to allow clients and agents to attach additional
  metadata to their interactions. Implementations MUST NOT make assumptions about values at
  these keys.

  See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)


- **`loadSession`** (`boolean`):
  Whether the agent supports `session/load`.

  * Default: `false`


- **`mcpCapabilities`** (`McpCapabilities`):
  MCP capabilities supported by the agent.

  * Default: `{"http":false,"sse":false}`


- **`promptCapabilities`** (`PromptCapabilities`):
  Prompt capabilities supported by the agent.

  * Default: `{"audio":false,"embeddedContext":false,"image":false}`


- **`sessionCapabilities`** (`SessionCapabilities`):
  * Default: `{}`


## `Annotations`

Optional annotations for the client. The client can use annotations to inform how objects are used or displayed

**Type:** Object

**Properties:**

- **`_meta`** (`object | null`):
  The \_meta property is reserved by ACP to allow clients and agents to attach additional
  metadata to their interactions. Implementations MUST NOT make assumptions about values at
  these keys.

  See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)


- **`audience`** (Role[] | null): 
- **`lastModified`** (string | null): 
- **`priority`** (number | null): 
## `AudioContent`

Audio provided to or from an LLM.

**Type:** Object

**Properties:**

- **`_meta`** (`object | null`):
  The \_meta property is reserved by ACP to allow clients and agents to attach additional
  metadata to their interactions. Implementations MUST NOT make assumptions about values at
  these keys.

  See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)


- **`annotations`** (`Annotations | null`): 
- **`data`** (required `string`): 
- **`mimeType`** (required `string`): 
## `AuthMethod`

Describes an available authentication method.

**Type:** Object

**Properties:**

- **`_meta`** (`object | null`):
  The \_meta property is reserved by ACP to allow clients and agents to attach additional
  metadata to their interactions. Implementations MUST NOT make assumptions about values at
  these keys.

  See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)


- **`description`** (`string | null`):
  Optional description providing more details about this authentication method.


- **`id`** (required `string`):
  Unique identifier for this authentication method.


- **`name`** (required `string`):
  Human-readable name of the authentication method.


## `AvailableCommand`

Information about a command.

**Type:** Object

**Properties:**

- **`_meta`** (`object | null`):
  The \_meta property is reserved by ACP to allow clients and agents to attach additional
  metadata to their interactions. Implementations MUST NOT make assumptions about values at
  these keys.

  See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)


- **`description`** (required `string`):
  Human-readable description of what the command does.


- **`input`** (`AvailableCommandInput | null`):
  Input for the command if required


- **`name`** (required `string`):
  Command name (e.g., `create_plan`, `research_codebase`).


## `AvailableCommandInput`

The input specification for a command.

**Type:** Union

- **`Variant`**:
  All text that was typed after the command name is provided as input.
- **`_meta`** (`object | null`):
      The \_meta property is reserved by ACP to allow clients and agents to attach additional
      metadata to their interactions. Implementations MUST NOT make assumptions about values at
      these keys.

      See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)
    

    - **`hint`** (required `string`):
      A hint to display when the input hasn't been provided yet
## `AvailableCommandsUpdate`

Available commands are ready or have changed

**Type:** Object

**Properties:**

- **`_meta`** (`object | null`):
  The \_meta property is reserved by ACP to allow clients and agents to attach additional
  metadata to their interactions. Implementations MUST NOT make assumptions about values at
  these keys.

  See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)


- **`availableCommands`** (required `AvailableCommand[]`):
  Commands the agent can execute


## `BlobResourceContents`

Binary resource contents.

**Type:** Object

**Properties:**

- **`_meta`** (`object | null`):
  The \_meta property is reserved by ACP to allow clients and agents to attach additional
  metadata to their interactions. Implementations MUST NOT make assumptions about values at
  these keys.

  See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)


- **`blob`** (required `string`): 
- **`mimeType`** (string | null): 
- **`uri`** (required `string`): 
## `ClientCapabilities`

Capabilities supported by the client.

Advertised during initialization to inform the agent about
available features and methods.

See protocol docs: [Client Capabilities](https://agentclientprotocol.com/protocol/initialization#client-capabilities)

**Type:** Object

**Properties:**

- **`_meta`** (`object | null`):
  The \_meta property is reserved by ACP to allow clients and agents to attach additional
  metadata to their interactions. Implementations MUST NOT make assumptions about values at
  these keys.

  See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)


- **`fs`** (`FileSystemCapability`):
  File system capabilities supported by the client.
  Determines which file operations the agent can request.

  * Default: `{"readTextFile":false,"writeTextFile":false}`


- **`terminal`** (`boolean`):
  Whether the Client support all `terminal/*` methods.

  * Default: `false`


## `Content`

Standard content block (text, images, resources).

**Type:** Object

**Properties:**

- **`_meta`** (`object | null`):
  The \_meta property is reserved by ACP to allow clients and agents to attach additional
  metadata to their interactions. Implementations MUST NOT make assumptions about values at
  these keys.

  See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)


- **`content`** (required `ContentBlock`):
  The actual content block.


## `ContentBlock`

Content blocks represent displayable information in the Agent Client Protocol.

They provide a structured way to handle various types of user-facing content—whether
it's text from language models, images for analysis, or embedded resources for context.

Content blocks appear in:

* User prompts sent via `session/prompt`
* Language model output streamed through `session/update` notifications
* Progress updates and results from tool calls

This structure is compatible with the Model Context Protocol (MCP), enabling
agents to seamlessly forward content from MCP tool outputs without transformation.

See protocol docs: [Content](https://agentclientprotocol.com/protocol/content)

**Type:** Union

- **`text`** (`object`):
  Text content. May be plain text or formatted with Markdown.

  All agents MUST support text content blocks in prompts.
  Clients SHOULD render this text as Markdown.
- **`_meta`** (`object | null`):
      The \_meta property is reserved by ACP to allow clients and agents to attach additional
      metadata to their interactions. Implementations MUST NOT make assumptions about values at
      these keys.

      See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)
    

    - **`annotations`** (`Annotations | null`): 
- **`text`** (required `string`): 
- **`type`** (required `string`):
- **`image`** (`object`):
  Images for visual context or analysis.

  Requires the `image` prompt capability when included in prompts.
- **`_meta`** (`object | null`):
      The \_meta property is reserved by ACP to allow clients and agents to attach additional
      metadata to their interactions. Implementations MUST NOT make assumptions about values at
      these keys.

      See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)
    

    - **`annotations`** (`Annotations | null`): 
- **`data`** (required `string`): 
- **`mimeType`** (required `string`): 
- **`type`** (required `string`): 
- **`uri`** (string | null):
- **`audio`** (`object`):
  Audio data for transcription or analysis.

  Requires the `audio` prompt capability when included in prompts.
- **`_meta`** (`object | null`):
      The \_meta property is reserved by ACP to allow clients and agents to attach additional
      metadata to their interactions. Implementations MUST NOT make assumptions about values at
      these keys.

      See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)
    

    - **`annotations`** (`Annotations | null`): 
- **`data`** (required `string`): 
- **`mimeType`** (required `string`): 
- **`type`** (required `string`):
- **`resource_link`** (`object`):
  References to resources that the agent can access.

  All agents MUST support resource links in prompts.
- **`_meta`** (`object | null`):
      The \_meta property is reserved by ACP to allow clients and agents to attach additional
      metadata to their interactions. Implementations MUST NOT make assumptions about values at
      these keys.

      See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)
    

    - **`annotations`** (`Annotations | null`): 
- **`description`** (string | null): 
- **`mimeType`** (string | null): 
- **`name`** (required `string`): 
- **`size`** (integer | null): 
- **`title`** (string | null): 
- **`type`** (required `string`): 
- **`uri`** (required `string`):
- **`resource`** (`object`):
  Complete resource contents embedded directly in the message.

  Preferred for including context as it avoids extra round-trips.

  Requires the `embeddedContext` prompt capability when included in prompts.
- **`_meta`** (`object | null`):
      The \_meta property is reserved by ACP to allow clients and agents to attach additional
      metadata to their interactions. Implementations MUST NOT make assumptions about values at
      these keys.

      See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)
    

    - **`annotations`** (`Annotations | null`): 
- **`resource`** (requiredEmbeddedResourceResource): 
- **`type`** (required `string`):
## `ContentChunk`

A streamed item of content

**Type:** Object

**Properties:**

- **`_meta`** (`object | null`):
  The \_meta property is reserved by ACP to allow clients and agents to attach additional
  metadata to their interactions. Implementations MUST NOT make assumptions about values at
  these keys.

  See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)


- **`content`** (required `ContentBlock`):
  A single item of content


## `CurrentModeUpdate`

The current mode of the session has changed

See protocol docs: [Session Modes](https://agentclientprotocol.com/protocol/session-modes)

**Type:** Object

**Properties:**

- **`_meta`** (`object | null`):
  The \_meta property is reserved by ACP to allow clients and agents to attach additional
  metadata to their interactions. Implementations MUST NOT make assumptions about values at
  these keys.

  See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)


- **`currentModeId`** (required `SessionModeId`):
  The ID of the current mode


## `Diff`

A diff representing file modifications.

Shows changes to files in a format suitable for display in the client UI.

See protocol docs: [Content](https://agentclientprotocol.com/protocol/tool-calls#content)

**Type:** Object

**Properties:**

- **`_meta`** (`object | null`):
  The \_meta property is reserved by ACP to allow clients and agents to attach additional
  metadata to their interactions. Implementations MUST NOT make assumptions about values at
  these keys.

  See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)


- **`newText`** (required `string`):
  The new content after modification.


- **`oldText`** (`string | null`):
  The original content (None for new files).


- **`path`** (required `string`):
  The file path being modified.


## `EmbeddedResource`

The contents of a resource, embedded into a prompt or tool call result.

**Type:** Object

**Properties:**

- **`_meta`** (`object | null`):
  The \_meta property is reserved by ACP to allow clients and agents to attach additional
  metadata to their interactions. Implementations MUST NOT make assumptions about values at
  these keys.

  See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)


- **`annotations`** (`Annotations | null`): 
- **`resource`** (requiredEmbeddedResourceResource): 
## `EmbeddedResourceResource`

Resource content that can be embedded in a message.

**Type:** Union

- **`TextResourceContents`**:
  {""}
- **`_meta`** (`object | null`):
      The \_meta property is reserved by ACP to allow clients and agents to attach additional
      metadata to their interactions. Implementations MUST NOT make assumptions about values at
      these keys.

      See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)
    

    - **`mimeType`** (string | null): 
- **`text`** (required `string`): 
- **`uri`** (required `string`):
- **`BlobResourceContents`**:
  {""}
- **`_meta`** (`object | null`):
      The \_meta property is reserved by ACP to allow clients and agents to attach additional
      metadata to their interactions. Implementations MUST NOT make assumptions about values at
      these keys.

      See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)
    

    - **`blob`** (required `string`): 
- **`mimeType`** (string | null): 
- **`uri`** (required `string`):
## `EnvVariable`

An environment variable to set when launching an MCP server.

**Type:** Object

**Properties:**

- **`_meta`** (`object | null`):
  The \_meta property is reserved by ACP to allow clients and agents to attach additional
  metadata to their interactions. Implementations MUST NOT make assumptions about values at
  these keys.

  See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)


- **`name`** (required `string`):
  The name of the environment variable.


- **`value`** (required `string`):
  The value to set for the environment variable.


## `Error`

JSON-RPC error object.

Represents an error that occurred during method execution, following the
JSON-RPC 2.0 error object specification with optional additional data.

See protocol docs: [JSON-RPC Error Object](https://www.jsonrpc.org/specification#error_object)

**Type:** Object

**Properties:**

- **`code`** (required `ErrorCode`):
  A number indicating the error type that occurred. This must be an integer as
  defined in the JSON-RPC specification.


- **`data`** (`object`):
  Optional primitive or structured value that contains additional information
  about the error. This may include debugging information or context-specific
  details.


- **`message`** (required `string`):
  A string providing a short description of the error. The message should be
  limited to a concise single sentence.


## `ErrorCode`

Predefined error codes for common JSON-RPC and ACP-specific errors.

These codes follow the JSON-RPC 2.0 specification for standard errors
and use the reserved range (-32000 to -32099) for protocol-specific errors.

**Type:** Union

- **`-32700`** (`int32`):
  **Parse error**: Invalid JSON was received by the server. An error occurred on
  the server while parsing the JSON text.


- **`-32600`** (`int32`):
  **Invalid request**: The JSON sent is not a valid Request object.


- **`-32601`** (`int32`):
  **Method not found**: The method does not exist or is not available.


- **`-32602`** (`int32`):
  **Invalid params**: Invalid method parameter(s).


- **`-32603`** (`int32`):
  **Internal error**: Internal JSON-RPC error. Reserved for
  implementation-defined server errors.


- **`-32000`** (`int32`):
  **Authentication required**: Authentication is required before this operation
  can be performed.


- **`-32002`** (`int32`):
  **Resource not found**: A given resource, such as a file, was not found.


- **`integer`** (`int32`):
  Other undefined error code.


## `ExtNotification`

Allows the Agent to send an arbitrary notification that is not part of the ACP spec.
Extension notifications provide a way to send one-way messages for custom functionality
while maintaining protocol compatibility.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)

## `ExtRequest`

Allows for sending an arbitrary request that is not part of the ACP spec.
Extension methods provide a way to add custom functionality while maintaining
protocol compatibility.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)

## `ExtResponse`

Allows for sending an arbitrary response to an `ExtRequest` that is not part of the ACP spec.
Extension methods provide a way to add custom functionality while maintaining
protocol compatibility.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)

## `FileSystemCapability`

Filesystem capabilities supported by the client.
File system capabilities that a client may support.

See protocol docs: [FileSystem](https://agentclientprotocol.com/protocol/initialization#filesystem)

**Type:** Object

**Properties:**

- **`_meta`** (`object | null`):
  The \_meta property is reserved by ACP to allow clients and agents to attach additional
  metadata to their interactions. Implementations MUST NOT make assumptions about values at
  these keys.

  See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)


- **`readTextFile`** (`boolean`):
  Whether the Client supports `fs/read_text_file` requests.

  * Default: `false`


- **`writeTextFile`** (`boolean`):
  Whether the Client supports `fs/write_text_file` requests.

  * Default: `false`


## `HttpHeader`

An HTTP header to set when making requests to the MCP server.

**Type:** Object

**Properties:**

- **`_meta`** (`object | null`):
  The \_meta property is reserved by ACP to allow clients and agents to attach additional
  metadata to their interactions. Implementations MUST NOT make assumptions about values at
  these keys.

  See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)


- **`name`** (required `string`):
  The name of the HTTP header.


- **`value`** (required `string`):
  The value to set for the HTTP header.


## `ImageContent`

An image provided to or from an LLM.

**Type:** Object

**Properties:**

- **`_meta`** (`object | null`):
  The \_meta property is reserved by ACP to allow clients and agents to attach additional
  metadata to their interactions. Implementations MUST NOT make assumptions about values at
  these keys.

  See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)


- **`annotations`** (`Annotations | null`): 
- **`data`** (required `string`): 
- **`mimeType`** (required `string`): 
- **`uri`** (string | null): 
## `Implementation`

Metadata about the implementation of the client or agent.
Describes the name and version of an MCP implementation, with an optional
title for UI representation.

**Type:** Object

**Properties:**

- **`_meta`** (`object | null`):
  The \_meta property is reserved by ACP to allow clients and agents to attach additional
  metadata to their interactions. Implementations MUST NOT make assumptions about values at
  these keys.

  See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)


- **`name`** (required `string`):
  Intended for programmatic or logical use, but can be used as a display
  name fallback if title isn’t present.


- **`title`** (`string | null`):
  Intended for UI and end-user contexts — optimized to be human-readable
  and easily understood.

  If not provided, the name should be used for display.


- **`version`** (required `string`):
  Version of the implementation. Can be displayed to the user or used
  for debugging or metrics purposes. (e.g. "1.0.0").


## `McpCapabilities`

MCP capabilities supported by the agent

**Type:** Object

**Properties:**

- **`_meta`** (`object | null`):
  The \_meta property is reserved by ACP to allow clients and agents to attach additional
  metadata to their interactions. Implementations MUST NOT make assumptions about values at
  these keys.

  See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)


- **`http`** (`boolean`):
  Agent supports `McpServer::Http`.

  * Default: `false`


- **`sse`** (`boolean`):
  Agent supports `McpServer::Sse`.

  * Default: `false`


## `McpServer`

Configuration for connecting to an MCP (Model Context Protocol) server.

MCP servers provide tools and context that the agent can use when
processing prompts.

See protocol docs: [MCP Servers](https://agentclientprotocol.com/protocol/session-setup#mcp-servers)

**Type:** Union

- **`http`** (`object`):
  HTTP transport configuration

  Only available when the Agent capabilities indicate `mcp_capabilities.http` is `true`.
- **`_meta`** (`object | null`):
      The \_meta property is reserved by ACP to allow clients and agents to attach additional
      metadata to their interactions. Implementations MUST NOT make assumptions about values at
      these keys.

      See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)
    

    - **`headers`** (required `HttpHeader[]`):
      HTTP headers to set when making requests to the MCP server.
    

    - **`name`** (required `string`):
      Human-readable name identifying this MCP server.
    

    - **`type`** (required `string`): 
- **`url`** (required `string`):
      URL to the MCP server.
- **`sse`** (`object`):
  SSE transport configuration

  Only available when the Agent capabilities indicate `mcp_capabilities.sse` is `true`.
- **`_meta`** (`object | null`):
      The \_meta property is reserved by ACP to allow clients and agents to attach additional
      metadata to their interactions. Implementations MUST NOT make assumptions about values at
      these keys.

      See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)
    

    - **`headers`** (required `HttpHeader[]`):
      HTTP headers to set when making requests to the MCP server.
    

    - **`name`** (required `string`):
      Human-readable name identifying this MCP server.
    

    - **`type`** (required `string`): 
- **`url`** (required `string`):
      URL to the MCP server.
- **`Variant`**:
  Stdio transport configuration

  All Agents MUST support this transport.
- **`_meta`** (`object | null`):
      The \_meta property is reserved by ACP to allow clients and agents to attach additional
      metadata to their interactions. Implementations MUST NOT make assumptions about values at
      these keys.

      See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)
    

    - **`args`** (required `string"[]`):
      Command-line arguments to pass to the MCP server.
    

    - **`command`** (required `string`):
      Path to the MCP server executable.
    

    - **`env`** (required `EnvVariable[]`):
      Environment variables to set when launching the MCP server.
    

    - **`name`** (required `string`):
      Human-readable name identifying this MCP server.
## `McpServerHttp`

HTTP transport configuration for MCP.

**Type:** Object

**Properties:**

- **`_meta`** (`object | null`):
  The \_meta property is reserved by ACP to allow clients and agents to attach additional
  metadata to their interactions. Implementations MUST NOT make assumptions about values at
  these keys.

  See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)


- **`headers`** (required `HttpHeader[]`):
  HTTP headers to set when making requests to the MCP server.


- **`name`** (required `string`):
  Human-readable name identifying this MCP server.


- **`url`** (required `string`):
  URL to the MCP server.


## `McpServerSse`

SSE transport configuration for MCP.

**Type:** Object

**Properties:**

- **`_meta`** (`object | null`):
  The \_meta property is reserved by ACP to allow clients and agents to attach additional
  metadata to their interactions. Implementations MUST NOT make assumptions about values at
  these keys.

  See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)


- **`headers`** (required `HttpHeader[]`):
  HTTP headers to set when making requests to the MCP server.


- **`name`** (required `string`):
  Human-readable name identifying this MCP server.


- **`url`** (required `string`):
  URL to the MCP server.


## `McpServerStdio`

Stdio transport configuration for MCP.

**Type:** Object

**Properties:**

- **`_meta`** (`object | null`):
  The \_meta property is reserved by ACP to allow clients and agents to attach additional
  metadata to their interactions. Implementations MUST NOT make assumptions about values at
  these keys.

  See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)


- **`args`** (required `string"[]`):
  Command-line arguments to pass to the MCP server.


- **`command`** (required `string`):
  Path to the MCP server executable.


- **`env`** (required `EnvVariable[]`):
  Environment variables to set when launching the MCP server.


- **`name`** (required `string`):
  Human-readable name identifying this MCP server.


## `PermissionOption`

An option presented to the user when requesting permission.

**Type:** Object

**Properties:**

- **`_meta`** (`object | null`):
  The \_meta property is reserved by ACP to allow clients and agents to attach additional
  metadata to their interactions. Implementations MUST NOT make assumptions about values at
  these keys.

  See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)


- **`kind`** (required `PermissionOptionKind`):
  Hint about the nature of this permission option.


- **`name`** (required `string`):
  Human-readable label to display to the user.


- **`optionId`** (required `PermissionOptionId`):
  Unique identifier for this permission option.


## `PermissionOptionId`

Unique identifier for a permission option.

**Type:** `string`

## `PermissionOptionKind`

The type of permission option being presented to the user.

Helps clients choose appropriate icons and UI treatment.

**Type:** Union

- **`allow_once`** (`string`):
  Allow this operation only this time.


- **`allow_always`** (`string`):
  Allow this operation and remember the choice.


- **`reject_once`** (`string`):
  Reject this operation only this time.


- **`reject_always`** (`string`):
  Reject this operation and remember the choice.


## `Plan`

An execution plan for accomplishing complex tasks.

Plans consist of multiple entries representing individual tasks or goals.
Agents report plans to clients to provide visibility into their execution strategy.
Plans can evolve during execution as the agent discovers new requirements or completes tasks.

See protocol docs: [Agent Plan](https://agentclientprotocol.com/protocol/agent-plan)

**Type:** Object

**Properties:**

- **`_meta`** (`object | null`):
  The \_meta property is reserved by ACP to allow clients and agents to attach additional
  metadata to their interactions. Implementations MUST NOT make assumptions about values at
  these keys.

  See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)


- **`entries`** (required `PlanEntry[]`):
  The list of tasks to be accomplished.

  When updating a plan, the agent must send a complete list of all entries
  with their current status. The client replaces the entire plan with each update.


## `PlanEntry`

A single entry in the execution plan.

Represents a task or goal that the assistant intends to accomplish
as part of fulfilling the user's request.
See protocol docs: [Plan Entries](https://agentclientprotocol.com/protocol/agent-plan#plan-entries)

**Type:** Object

**Properties:**

- **`_meta`** (`object | null`):
  The \_meta property is reserved by ACP to allow clients and agents to attach additional
  metadata to their interactions. Implementations MUST NOT make assumptions about values at
  these keys.

  See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)


- **`content`** (required `string`):
  Human-readable description of what this task aims to accomplish.


- **`priority`** (required `PlanEntryPriority`):
  The relative importance of this task.
  Used to indicate which tasks are most critical to the overall goal.


- **`status`** (required `PlanEntryStatus`):
  Current execution status of this task.


## `PlanEntryPriority`

Priority levels for plan entries.

Used to indicate the relative importance or urgency of different
tasks in the execution plan.
See protocol docs: [Plan Entries](https://agentclientprotocol.com/protocol/agent-plan#plan-entries)

**Type:** Union

- **`high`** (`string`):
  High priority task - critical to the overall goal.


- **`medium`** (`string`):
  Medium priority task - important but not critical.


- **`low`** (`string`):
  Low priority task - nice to have but not essential.


## `PlanEntryStatus`

Status of a plan entry in the execution flow.

Tracks the lifecycle of each task from planning through completion.
See protocol docs: [Plan Entries](https://agentclientprotocol.com/protocol/agent-plan#plan-entries)

**Type:** Union

- **`pending`** (`string`):
  The task has not started yet.


- **`in_progress`** (`string`):
  The task is currently being worked on.


- **`completed`** (`string`):
  The task has been successfully completed.


## `PromptCapabilities`

Prompt capabilities supported by the agent in `session/prompt` requests.

Baseline agent functionality requires support for `ContentBlock::Text`
and `ContentBlock::ResourceLink` in prompt requests.

Other variants must be explicitly opted in to.
Capabilities for different types of content in prompt requests.

Indicates which content types beyond the baseline (text and resource links)
the agent can process.

See protocol docs: [Prompt Capabilities](https://agentclientprotocol.com/protocol/initialization#prompt-capabilities)

**Type:** Object

**Properties:**

- **`_meta`** (`object | null`):
  The \_meta property is reserved by ACP to allow clients and agents to attach additional
  metadata to their interactions. Implementations MUST NOT make assumptions about values at
  these keys.

  See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)


- **`audio`** (`boolean`):
  Agent supports `ContentBlock::Audio`.

  * Default: `false`


- **`embeddedContext`** (`boolean`):
  Agent supports embedded context in `session/prompt` requests.

  When enabled, the Client is allowed to include `ContentBlock::Resource`
  in prompt requests for pieces of context that are referenced in the message.

  * Default: `false`


- **`image`** (`boolean`):
  Agent supports `ContentBlock::Image`.

  * Default: `false`


## `ProtocolVersion`

Protocol version identifier.

This version is only bumped for breaking changes.
Non-breaking changes should be introduced via capabilities.

**Type:** `integer (uint16)`

| Constraint | Value   |
| ---------- | ------- |
| Minimum    | `0`     |
| Maximum    | `65535` |

## `RequestId`

JSON RPC Request Id

An identifier established by the Client that MUST contain a String, Number, or NULL value if included. If it is not included it is assumed to be a notification. The value SHOULD normally not be Null \[1] and Numbers SHOULD NOT contain fractional parts \[2]

The Server MUST reply with the same value in the Response object if included. This member is used to correlate the context between the two objects.

\[1] The use of Null as a value for the id member in a Request object is discouraged, because this specification uses a value of Null for Responses with an unknown id. Also, because JSON-RPC 1.0 uses an id value of Null for Notifications this could cause confusion in handling.

\[2] Fractional parts may be problematic, since many decimal fractions cannot be represented exactly as binary fractions.

**Type:** Union

- **`null`** (`null`):
  {""}


- **`integer`** (`int64`):
  {""}


- **`string`** (`string`):
  {""}


## `RequestPermissionOutcome`

The outcome of a permission request.

**Type:** Union

- **`cancelled`** (`object`):
  The prompt turn was cancelled before the user responded.

  When a client sends a `session/cancel` notification to cancel an ongoing
  prompt turn, it MUST respond to all pending `session/request_permission`
  requests with this `Cancelled` outcome.

  See protocol docs: [Cancellation](https://agentclientprotocol.com/protocol/prompt-turn#cancellation)
- **`outcome`** (required `string`):
- **`selected`** (`object`):
  The user selected one of the provided options.
- **`_meta`** (`object | null`):
      The \_meta property is reserved by ACP to allow clients and agents to attach additional
      metadata to their interactions. Implementations MUST NOT make assumptions about values at
      these keys.

      See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)
    

    - **`optionId`** (required `PermissionOptionId`):
      The ID of the option the user selected.
    

    - **`outcome`** (required `string`):
## `ResourceLink`

A resource that the server is capable of reading, included in a prompt or tool call result.

**Type:** Object

**Properties:**

- **`_meta`** (`object | null`):
  The \_meta property is reserved by ACP to allow clients and agents to attach additional
  metadata to their interactions. Implementations MUST NOT make assumptions about values at
  these keys.

  See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)


- **`annotations`** (`Annotations | null`): 
- **`description`** (string | null): 
- **`mimeType`** (string | null): 
- **`name`** (required `string`): 
- **`size`** (integer | null): 
- **`title`** (string | null): 
- **`uri`** (required `string`): 
## `Role`

The sender or recipient of messages and data in a conversation.

**Type:** Enumeration

| Value         |
| ------------- |
| `"assistant"` |
| `"user"`      |

## `SelectedPermissionOutcome`

The user selected one of the provided options.

**Type:** Object

**Properties:**

- **`_meta`** (`object | null`):
  The \_meta property is reserved by ACP to allow clients and agents to attach additional
  metadata to their interactions. Implementations MUST NOT make assumptions about values at
  these keys.

  See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)


- **`optionId`** (required `PermissionOptionId`):
  The ID of the option the user selected.


## `SessionCapabilities`

Session capabilities supported by the agent.

As a baseline, all Agents **MUST** support `session/new`, `session/prompt`, `session/cancel`, and `session/update`.

Optionally, they **MAY** support other session methods and notifications by specifying additional capabilities.

Note: `session/load` is still handled by the top-level `load_session` capability. This will be unified in future versions of the protocol.

See protocol docs: [Session Capabilities](https://agentclientprotocol.com/protocol/initialization#session-capabilities)

**Type:** Object

**Properties:**

- **`_meta`** (`object | null`):
  The \_meta property is reserved by ACP to allow clients and agents to attach additional
  metadata to their interactions. Implementations MUST NOT make assumptions about values at
  these keys.

  See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)


## `SessionId`

A unique identifier for a conversation session between a client and agent.

Sessions maintain their own context, conversation history, and state,
allowing multiple independent interactions with the same agent.

See protocol docs: [Session ID](https://agentclientprotocol.com/protocol/session-setup#session-id)

**Type:** `string`

## `SessionMode`

A mode the agent can operate in.

See protocol docs: [Session Modes](https://agentclientprotocol.com/protocol/session-modes)

**Type:** Object

**Properties:**

- **`_meta`** (`object | null`):
  The \_meta property is reserved by ACP to allow clients and agents to attach additional
  metadata to their interactions. Implementations MUST NOT make assumptions about values at
  these keys.

  See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)


- **`description`** (string | null): 
- **`id`** (requiredSessionModeId): 
- **`name`** (required `string`): 
## `SessionModeId`

Unique identifier for a Session Mode.

**Type:** `string`

## `SessionModeState`

The set of modes and the one currently active.

**Type:** Object

**Properties:**

- **`_meta`** (`object | null`):
  The \_meta property is reserved by ACP to allow clients and agents to attach additional
  metadata to their interactions. Implementations MUST NOT make assumptions about values at
  these keys.

  See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)


- **`availableModes`** (required `SessionMode[]`):
  The set of modes that the Agent can operate in


- **`currentModeId`** (required `SessionModeId`):
  The current mode the Agent is in.


## `SessionUpdate`

Different types of updates that can be sent during session processing.

These updates provide real-time feedback about the agent's progress.

See protocol docs: [Agent Reports Output](https://agentclientprotocol.com/protocol/prompt-turn#3-agent-reports-output)

**Type:** Union

- **`user_message_chunk`** (`object`):
  A chunk of the user's message being streamed.
- **`_meta`** (`object | null`):
      The \_meta property is reserved by ACP to allow clients and agents to attach additional
      metadata to their interactions. Implementations MUST NOT make assumptions about values at
      these keys.

      See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)
    

    - **`content`** (required `ContentBlock`):
      A single item of content
    

    - **`sessionUpdate`** (required `string`):
- **`agent_message_chunk`** (`object`):
  A chunk of the agent's response being streamed.
- **`_meta`** (`object | null`):
      The \_meta property is reserved by ACP to allow clients and agents to attach additional
      metadata to their interactions. Implementations MUST NOT make assumptions about values at
      these keys.

      See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)
    

    - **`content`** (required `ContentBlock`):
      A single item of content
    

    - **`sessionUpdate`** (required `string`):
- **`agent_thought_chunk`** (`object`):
  A chunk of the agent's internal reasoning being streamed.
- **`_meta`** (`object | null`):
      The \_meta property is reserved by ACP to allow clients and agents to attach additional
      metadata to their interactions. Implementations MUST NOT make assumptions about values at
      these keys.

      See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)
    

    - **`content`** (required `ContentBlock`):
      A single item of content
    

    - **`sessionUpdate`** (required `string`):
- **`tool_call`** (`object`):
  Notification that a new tool call has been initiated.
- **`_meta`** (`object | null`):
      The \_meta property is reserved by ACP to allow clients and agents to attach additional
      metadata to their interactions. Implementations MUST NOT make assumptions about values at
      these keys.

      See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)
    

    - **`content`** (`ToolCallContent[]`):
      Content produced by the tool call.
    

    - **`kind`** (`ToolKind`):
      The category of tool being invoked.
      Helps clients choose appropriate icons and UI treatment.
    

    - **`locations`** (`ToolCallLocation[]`):
      File locations affected by this tool call.
      Enables "follow-along" features in clients.
    

    - **`rawInput`** (`object`):
      Raw input parameters sent to the tool.
    

    - **`rawOutput`** (`object`):
      Raw output returned by the tool.
    

    - **`sessionUpdate`** (required `string`): 
- **`status`** (`ToolCallStatus`):
      Current execution status of the tool call.
    

    - **`title`** (required `string`):
      Human-readable title describing what the tool is doing.
    

    - **`toolCallId`** (required `ToolCallId`):
      Unique identifier for this tool call within the session.
- **`tool_call_update`** (`object`):
  Update on the status or results of a tool call.
- **`_meta`** (`object | null`):
      The \_meta property is reserved by ACP to allow clients and agents to attach additional
      metadata to their interactions. Implementations MUST NOT make assumptions about values at
      these keys.

      See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)
    

    - **`content`** (`ToolCallContent[] | null`):
      Replace the content collection.
    

    - **`kind`** (`ToolKind | null`):
      Update the tool kind.
    

    - **`locations`** (`ToolCallLocation[] | null`):
      Replace the locations collection.
    

    - **`rawInput`** (`object`):
      Update the raw input.
    

    - **`rawOutput`** (`object`):
      Update the raw output.
    

    - **`sessionUpdate`** (required `string`): 
- **`status`** (`ToolCallStatus | null`):
      Update the execution status.
    

    - **`title`** (`string | null`):
      Update the human-readable title.
    

    - **`toolCallId`** (required `ToolCallId`):
      The ID of the tool call being updated.
- **`plan`** (`object`):
  The agent's execution plan for complex tasks.
  See protocol docs: [Agent Plan](https://agentclientprotocol.com/protocol/agent-plan)
- **`_meta`** (`object | null`):
      The \_meta property is reserved by ACP to allow clients and agents to attach additional
      metadata to their interactions. Implementations MUST NOT make assumptions about values at
      these keys.

      See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)
    

    - **`entries`** (required `PlanEntry[]`):
      The list of tasks to be accomplished.

      When updating a plan, the agent must send a complete list of all entries
      with their current status. The client replaces the entire plan with each update.
    

    - **`sessionUpdate`** (required `string`):
- **`available_commands_update`** (`object`):
  Available commands are ready or have changed
- **`_meta`** (`object | null`):
      The \_meta property is reserved by ACP to allow clients and agents to attach additional
      metadata to their interactions. Implementations MUST NOT make assumptions about values at
      these keys.

      See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)
    

    - **`availableCommands`** (required `AvailableCommand[]`):
      Commands the agent can execute
    

    - **`sessionUpdate`** (required `string`):
- **`current_mode_update`** (`object`):
  The current mode of the session has changed

  See protocol docs: [Session Modes](https://agentclientprotocol.com/protocol/session-modes)
- **`_meta`** (`object | null`):
      The \_meta property is reserved by ACP to allow clients and agents to attach additional
      metadata to their interactions. Implementations MUST NOT make assumptions about values at
      these keys.

      See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)
    

    - **`currentModeId`** (required `SessionModeId`):
      The ID of the current mode
    

    - **`sessionUpdate`** (required `string`):
## `StopReason`

Reasons why an agent stops processing a prompt turn.

See protocol docs: [Stop Reasons](https://agentclientprotocol.com/protocol/prompt-turn#stop-reasons)

**Type:** Union

- **`end_turn`** (`string`):
  The turn ended successfully.


- **`max_tokens`** (`string`):
  The turn ended because the agent reached the maximum number of tokens.


- **`max_turn_requests`** (`string`):
  The turn ended because the agent reached the maximum number of allowed agent
  requests between user turns.


- **`refusal`** (`string`):
  The turn ended because the agent refused to continue. The user prompt and
  everything that comes after it won't be included in the next prompt, so this
  should be reflected in the UI.


- **`cancelled`** (`string`):
  The turn was cancelled by the client via `session/cancel`.

  This stop reason MUST be returned when the client sends a `session/cancel`
  notification, even if the cancellation causes exceptions in underlying operations.
  Agents should catch these exceptions and return this semantically meaningful
  response to confirm successful cancellation.


## `Terminal`

Embed a terminal created with `terminal/create` by its id.

The terminal must be added before calling `terminal/release`.

See protocol docs: [Terminal](https://agentclientprotocol.com/protocol/terminals)

**Type:** Object

**Properties:**

- **`_meta`** (`object | null`):
  The \_meta property is reserved by ACP to allow clients and agents to attach additional
  metadata to their interactions. Implementations MUST NOT make assumptions about values at
  these keys.

  See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)


- **`terminalId`** (required `string`): 
## `TerminalExitStatus`

Exit status of a terminal command.

**Type:** Object

**Properties:**

- **`_meta`** (`object | null`):
  The \_meta property is reserved by ACP to allow clients and agents to attach additional
  metadata to their interactions. Implementations MUST NOT make assumptions about values at
  these keys.

  See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)


- **`exitCode`** (`integer | null`):
  The process exit code (may be null if terminated by signal).

  * Minimum: `0`


- **`signal`** (`string | null`):
  The signal that terminated the process (may be null if exited normally).


## `TextContent`

Text provided to or from an LLM.

**Type:** Object

**Properties:**

- **`_meta`** (`object | null`):
  The \_meta property is reserved by ACP to allow clients and agents to attach additional
  metadata to their interactions. Implementations MUST NOT make assumptions about values at
  these keys.

  See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)


- **`annotations`** (`Annotations | null`): 
- **`text`** (required `string`): 
## `TextResourceContents`

Text-based resource contents.

**Type:** Object

**Properties:**

- **`_meta`** (`object | null`):
  The \_meta property is reserved by ACP to allow clients and agents to attach additional
  metadata to their interactions. Implementations MUST NOT make assumptions about values at
  these keys.

  See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)


- **`mimeType`** (string | null): 
- **`text`** (required `string`): 
- **`uri`** (required `string`): 
## `ToolCall`

Represents a tool call that the language model has requested.

Tool calls are actions that the agent executes on behalf of the language model,
such as reading files, executing code, or fetching data from external sources.

See protocol docs: [Tool Calls](https://agentclientprotocol.com/protocol/tool-calls)

**Type:** Object

**Properties:**

- **`_meta`** (`object | null`):
  The \_meta property is reserved by ACP to allow clients and agents to attach additional
  metadata to their interactions. Implementations MUST NOT make assumptions about values at
  these keys.

  See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)


- **`content`** (`ToolCallContent[]`):
  Content produced by the tool call.


- **`kind`** (`ToolKind`):
  The category of tool being invoked.
  Helps clients choose appropriate icons and UI treatment.


- **`locations`** (`ToolCallLocation[]`):
  File locations affected by this tool call.
  Enables "follow-along" features in clients.


- **`rawInput`** (`object`):
  Raw input parameters sent to the tool.


- **`rawOutput`** (`object`):
  Raw output returned by the tool.


- **`status`** (`ToolCallStatus`):
  Current execution status of the tool call.


- **`title`** (required `string`):
  Human-readable title describing what the tool is doing.


- **`toolCallId`** (required `ToolCallId`):
  Unique identifier for this tool call within the session.


## `ToolCallContent`

Content produced by a tool call.

Tool calls can produce different types of content including
standard content blocks (text, images) or file diffs.

See protocol docs: [Content](https://agentclientprotocol.com/protocol/tool-calls#content)

**Type:** Union

- **`content`** (`object`):
  Standard content block (text, images, resources).
- **`_meta`** (`object | null`):
      The \_meta property is reserved by ACP to allow clients and agents to attach additional
      metadata to their interactions. Implementations MUST NOT make assumptions about values at
      these keys.

      See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)
    

    - **`content`** (required `ContentBlock`):
      The actual content block.
    

    - **`type`** (required `string`):
- **`diff`** (`object`):
  File modification shown as a diff.
- **`_meta`** (`object | null`):
      The \_meta property is reserved by ACP to allow clients and agents to attach additional
      metadata to their interactions. Implementations MUST NOT make assumptions about values at
      these keys.

      See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)
    

    - **`newText`** (required `string`):
      The new content after modification.
    

    - **`oldText`** (`string | null`):
      The original content (None for new files).
    

    - **`path`** (required `string`):
      The file path being modified.
    

    - **`type`** (required `string`):
- **`terminal`** (`object`):
  Embed a terminal created with `terminal/create` by its id.

  The terminal must be added before calling `terminal/release`.

  See protocol docs: [Terminal](https://agentclientprotocol.com/protocol/terminals)
- **`_meta`** (`object | null`):
      The \_meta property is reserved by ACP to allow clients and agents to attach additional
      metadata to their interactions. Implementations MUST NOT make assumptions about values at
      these keys.

      See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)
    

    - **`terminalId`** (required `string`): 
- **`type`** (required `string`):
## `ToolCallId`

Unique identifier for a tool call within a session.

**Type:** `string`

## `ToolCallLocation`

A file location being accessed or modified by a tool.

Enables clients to implement "follow-along" features that track
which files the agent is working with in real-time.

See protocol docs: [Following the Agent](https://agentclientprotocol.com/protocol/tool-calls#following-the-agent)

**Type:** Object

**Properties:**

- **`_meta`** (`object | null`):
  The \_meta property is reserved by ACP to allow clients and agents to attach additional
  metadata to their interactions. Implementations MUST NOT make assumptions about values at
  these keys.

  See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)


- **`line`** (`integer | null`):
  Optional line number within the file.

  * Minimum: `0`


- **`path`** (required `string`):
  The file path being accessed or modified.


## `ToolCallStatus`

Execution status of a tool call.

Tool calls progress through different statuses during their lifecycle.

See protocol docs: [Status](https://agentclientprotocol.com/protocol/tool-calls#status)

**Type:** Union

- **`pending`** (`string`):
  The tool call hasn't started running yet because the input is either streaming
  or we're awaiting approval.


- **`in_progress`** (`string`):
  The tool call is currently running.


- **`completed`** (`string`):
  The tool call completed successfully.


- **`failed`** (`string`):
  The tool call failed with an error.


## `ToolCallUpdate`

An update to an existing tool call.

Used to report progress and results as tools execute. All fields except
the tool call ID are optional - only changed fields need to be included.

See protocol docs: [Updating](https://agentclientprotocol.com/protocol/tool-calls#updating)

**Type:** Object

**Properties:**

- **`_meta`** (`object | null`):
  The \_meta property is reserved by ACP to allow clients and agents to attach additional
  metadata to their interactions. Implementations MUST NOT make assumptions about values at
  these keys.

  See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)


- **`content`** (`ToolCallContent[] | null`):
  Replace the content collection.


- **`kind`** (`ToolKind | null`):
  Update the tool kind.


- **`locations`** (`ToolCallLocation[] | null`):
  Replace the locations collection.


- **`rawInput`** (`object`):
  Update the raw input.


- **`rawOutput`** (`object`):
  Update the raw output.


- **`status`** (`ToolCallStatus | null`):
  Update the execution status.


- **`title`** (`string | null`):
  Update the human-readable title.


- **`toolCallId`** (required `ToolCallId`):
  The ID of the tool call being updated.


## `ToolKind`

Categories of tools that can be invoked.

Tool kinds help clients choose appropriate icons and optimize how they
display tool execution progress.

See protocol docs: [Creating](https://agentclientprotocol.com/protocol/tool-calls#creating)

**Type:** Union

- **`read`** (`string`):
  Reading files or data.


- **`edit`** (`string`):
  Modifying files or content.


- **`delete`** (`string`):
  Removing files or data.


- **`move`** (`string`):
  Moving or renaming files.


- **`search`** (`string`):
  Searching for information.


- **`execute`** (`string`):
  Running commands or code.


- **`think`** (`string`):
  Internal reasoning or planning.


- **`fetch`** (`string`):
  Retrieving external data.


- **`switch_mode`** (`string`):
  Switching the current session mode.


- **`other`** (`string`):
  Other tool types (default).


## `UnstructuredCommandInput`

All text that was typed after the command name is provided as input.

**Type:** Object

**Properties:**

- **`_meta`** (`object | null`):
  The \_meta property is reserved by ACP to allow clients and agents to attach additional
  metadata to their interactions. Implementations MUST NOT make assumptions about values at
  these keys.

  See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/extensibility)


- **`hint`** (required `string`):
  A hint to display when the input hasn't been provided yet


---

> To find navigation and other pages in this documentation, fetch the llms.txt file at: https://agentclientprotocol.com/llms.txt