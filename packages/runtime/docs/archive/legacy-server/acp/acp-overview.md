# Overview

> How the Agent Client Protocol works

The Agent Client Protocol allows [Agents](#agent) and [Clients](#client) to communicate by exposing methods that each side can call and sending notifications to inform each other of events.

## Communication Model

The protocol follows the [JSON-RPC 2.0](https://www.jsonrpc.org/specification) specification with two types of messages:

* **Methods**: Request-response pairs that expect a result or error
* **Notifications**: One-way messages that don't expect a response

## Message Flow

A typical flow follows this pattern:

### 1. Initialization Phase

* Client → Agent: `initialize` to establish connection
* Client → Agent: `authenticate` if required by the Agent

### 2. Session Setup — either:

* Client → Agent: `session/new` to create a new session
* Client → Agent: `session/load` to resume an existing session if supported

### 3. Prompt Turn

* Client → Agent: `session/prompt` to send user message
* Agent → Client: `session/update` notifications for progress updates
* Agent → Client: File operations or permission requests as needed
* Client → Agent: `session/cancel` to interrupt processing if needed
* Turn ends and the Agent sends the `session/prompt` response with a stop reason

## Agent

Agents are programs that use generative AI to autonomously modify code. They typically run as subprocesses of the Client.

### Baseline Methods

- **`initialize`** ([Schema](./acp-schema#initialize)): [Negotiate versions and exchange capabilities.](./acp-initialization)
- **`authenticate`** ([Schema](./acp-schema#authenticate)): Authenticate with the Agent (if required).
- **`session/new`** ([Schema](./acp-schema#session%2Fnew)): [Create a new conversation session](./acp-session-setup#creating-a-session).
- **`session/prompt`** ([Schema](./acp-schema#session%2Fprompt)): [Send user prompts](./acp-prompt-turn#1-user-message) to the Agent.

### Optional Methods

- **`session/load`** ([Schema](./acp-schema#session%2Fload)): [Load an existing session](./acp-session-setup#loading-sessions) (requires `loadSession` capability).
- **`session/set_mode`** ([Schema](./acp-schema#session%2Fset-mode)): [Switch between agent operating modes](./acp-session-mode#setting-the-current-mode).

### Notifications

- **`session/cancel`** ([Schema](./acp-schema#session%2Fcancel)): [Cancel ongoing operations](./acp-prompt-turn#cancellation) (no response expected).

## Client

Clients provide the interface between users and agents. They are typically code editors (IDEs, text editors) but can also be other UIs for interacting with agents. Clients manage the environment, handle user interactions, and control access to resources.

### Baseline Methods

- **`session/request_permission`** ([Schema](./acp-schema#session%2Frequest_permission)): [Request user authorization](./acp-tool-call#requesting-permission) for tool calls.

### Optional Methods

- **`fs/read_text_file`** ([Schema](./acp-schema#fs%2Fread_text_file)): [Read file contents](./acp-file-system#reading-files) (requires `fs.readTextFile` capability).
- **`fs/write_text_file`** ([Schema](./acp-schema#fs%2Fwrite_text_file)): [Write file contents](./acp-file-system#writing-files) (requires `fs.writeTextFile` capability).
- **`terminal/create`** ([Schema](./acp-schema#terminal%2Fcreate)): [Create a new terminal](./acp-terminal) (requires `terminal` capability).
- **`terminal/output`** ([Schema](./acp-schema#terminal%2Foutput)): Get terminal output and exit status (requires `terminal` capability).
- **`terminal/release`** ([Schema](./acp-schema#terminal%2Frelease)): Release a terminal (requires `terminal` capability).
- **`terminal/wait_for_exit`** ([Schema](./acp-schema#terminal%2Fwait_for_exit)): Wait for terminal command to exit (requires `terminal` capability).
- **`terminal/kill`** ([Schema](./acp-schema#terminal%2Fkill)): Kill terminal command without releasing (requires `terminal` capability).

### Notifications

- **`session/update`** ([Schema](./acp-schema#session%2Fupdate)): [Send session updates](./acp-prompt-turn#3-agent-reports-output) to inform the Client of changes (no response expected). This includes:
  - [Message chunks](./acp-content) (agent, user, thought)
  - [Tool calls and updates](./acp-tool-call)
  - [Plans](./acp-agent-plan)
  - [Available commands updates](./acp-slash-command#advertising-commands)
  - [Mode changes](./acp-session-mode#from-the-agent)

## Argument requirements

* All file paths in the protocol **MUST** be absolute.
* Line numbers are 1-based

## Error Handling

All methods follow standard JSON-RPC 2.0 [error handling](https://www.jsonrpc.org/specification#error_object):

* Successful responses include a `result` field
* Errors include an `error` object with `code` and `message`
* Notifications never receive responses (success or error)

## Extensibility

The protocol provides built-in mechanisms for adding custom functionality while maintaining compatibility:

* Add custom data using `_meta` fields
* Create custom methods by prefixing their name with underscore (`_`)
* Advertise custom capabilities during initialization

Learn about [protocol extensibility](./acp-extensibility) to understand how to use these mechanisms.

## Next Steps

* Learn about [Initialization](./acp-initialization) to understand version and capability negotiation
* Understand [Session Setup](./acp-session-setup) for creating and loading sessions
* Review the [Prompt Turn](./acp-prompt-turn) lifecycle
* Explore [Extensibility](./acp-extensibility) to add custom features

---

> To find navigation and other pages in this documentation, fetch the llms.txt file at: https://agentclientprotocol.com/llms.txt