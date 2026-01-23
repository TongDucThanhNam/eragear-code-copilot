---
title: "ClientSideConnection | Agent Client Protocol - v0.12.0"
source: "https://agentclientprotocol.github.io/typescript-sdk/classes/ClientSideConnection.html"
author:
published:
created: 2025-12-30
description: "Documentation for Agent Client Protocol"
tags:
  - "clippings"
---
A client-side connection to an agent.

This class provides the client's view of an ACP connection, allowing clients (such as code editors) to communicate with agents. It implements the [Agent](https://agentclientprotocol.github.io/typescript-sdk/interfaces/Agent.html) interface to provide methods for initializing sessions, sending prompts, and managing the agent lifecycle.

See protocol docs: [Client](https://agentclientprotocol.com/protocol/overview#client)

#### Implements

- [Agent](https://agentclientprotocol.github.io/typescript-sdk/interfaces/Agent.html)

## Constructors

### constructor

- new ClientSideConnection (  
	toClient:(agent:[Agent](https://agentclientprotocol.github.io/typescript-sdk/interfaces/Agent.html)) \=> [Client](https://agentclientprotocol.github.io/typescript-sdk/interfaces/Client.html),  
	stream:[Stream](https://agentclientprotocol.github.io/typescript-sdk/types/Stream.html),  
	):ClientSideConnection
	Creates a new client-side connection to an agent.
	This establishes the communication channel between a client and agent following the ACP specification.
	#### Parameters
	- toClient: (agent:[Agent](https://agentclientprotocol.github.io/typescript-sdk/interfaces/Agent.html)) \=> [Client](https://agentclientprotocol.github.io/typescript-sdk/interfaces/Client.html)
		A function that creates a Client handler to process incoming agent requests
	- stream: [Stream](https://agentclientprotocol.github.io/typescript-sdk/types/Stream.html)
		The bidirectional message stream for communication. Typically created using [ndJsonStream](https://agentclientprotocol.github.io/typescript-sdk/functions/ndJsonStream.html) for stdio-based connections.
		See protocol docs: [Communication Model](https://agentclientprotocol.com/protocol/overview#communication-model)
	#### Returns ClientSideConnection

## Accessors

### signal

- get signal ():AbortSignal
	AbortSignal that aborts when the connection closes.
	This signal can be used to:
	- Listen for connection closure: `connection.signal.addEventListener('abort', () => {...})`
	- Check connection status synchronously: `if (connection.signal.aborted) {...}`
	- Pass to other APIs (fetch, setTimeout) for automatic cancellation
	The connection closes when the underlying stream ends, either normally or due to an error.
	#### Returns AbortSignal
	#### Example
	```typescript
	const connection = new ClientSideConnection(client, stream);
	// Listen for closure
	connection.signal.addEventListener('abort', () => {
	  console.log('Connection closed - performing cleanup');
	});
	// Check status
	if (connection.signal.aborted) {
	  console.log('Connection is already closed');
	}
	// Pass to other APIs
	fetch(url, { signal: connection.signal });
	```

### closed

- get closed ():Promise < void \>
	Promise that resolves when the connection closes.
	The connection closes when the underlying stream ends, either normally or due to an error. Once closed, the connection cannot send or receive any more messages.
	This is useful for async/await style cleanup:
	#### Returns Promise<void>
	#### Example
	```typescript
	const connection = new ClientSideConnection(client, stream);
	await connection.closed;
	console.log('Connection closed - performing cleanup');
	```

## Methods

### initialize

- Establishes the connection with a client and negotiates protocol capabilities.
	This method is called once at the beginning of the connection to:
	- Negotiate the protocol version to use
	- Exchange capability information between client and agent
	- Determine available authentication methods
	The agent should respond with its supported protocol version and capabilities.
	See protocol docs: [Initialization](https://agentclientprotocol.com/protocol/initialization)
	#### Parameters
	- params: [InitializeRequest](https://agentclientprotocol.github.io/typescript-sdk/types/InitializeRequest.html)
	#### Returns Promise<InitializeResponse>

### newSession

- Creates a new conversation session with the agent.
	Sessions represent independent conversation contexts with their own history and state.
	The agent should:
	- Create a new session context
	- Connect to any specified MCP servers
	- Return a unique session ID for future requests
	May return an `auth_required` error if the agent requires authentication.
	See protocol docs: [Session Setup](https://agentclientprotocol.com/protocol/session-setup)
	#### Parameters
	- params: [NewSessionRequest](https://agentclientprotocol.github.io/typescript-sdk/types/NewSessionRequest.html)
	#### Returns Promise<NewSessionResponse>

### loadSession

- Loads an existing session to resume a previous conversation.
	This method is only available if the agent advertises the `loadSession` capability.
	The agent should:
	- Restore the session context and conversation history
	- Connect to the specified MCP servers
	- Stream the entire conversation history back to the client via notifications
	See protocol docs: [Loading Sessions](https://agentclientprotocol.com/protocol/session-setup#loading-sessions)
	#### Parameters
	- params: [LoadSessionRequest](https://agentclientprotocol.github.io/typescript-sdk/types/LoadSessionRequest.html)
	#### Returns Promise<LoadSessionResponse>

### unstable\_forkSession

- unstable\_forkSession (params:[ForkSessionRequest](https://agentclientprotocol.github.io/typescript-sdk/types/ForkSessionRequest.html)):Promise < [ForkSessionResponse](https://agentclientprotocol.github.io/typescript-sdk/types/ForkSessionResponse.html) \>
	`Experimental`
	**UNSTABLE**
	This capability is not part of the spec yet, and may be removed or changed at any point.
	Forks an existing session to create a new independent session.
	Creates a new session based on the context of an existing one, allowing operations like generating summaries without affecting the original session's history.
	This method is only available if the agent advertises the `session.fork` capability.
	#### Parameters
	- params: [ForkSessionRequest](https://agentclientprotocol.github.io/typescript-sdk/types/ForkSessionRequest.html)
	#### Returns Promise<ForkSessionResponse>

### unstable\_listSessions

- unstable\_listSessions (  
	params:[ListSessionsRequest](https://agentclientprotocol.github.io/typescript-sdk/types/ListSessionsRequest.html),  
	):Promise < [ListSessionsResponse](https://agentclientprotocol.github.io/typescript-sdk/types/ListSessionsResponse.html) \>
	`Experimental`
	**UNSTABLE**
	This capability is not part of the spec yet, and may be removed or changed at any point.
	Lists existing sessions from the agent.
	This method is only available if the agent advertises the `listSessions` capability.
	Returns a list of sessions with metadata like session ID, working directory, title, and last update time. Supports filtering by working directory and cursor-based pagination.
	#### Parameters
	- params: [ListSessionsRequest](https://agentclientprotocol.github.io/typescript-sdk/types/ListSessionsRequest.html)
	#### Returns Promise<ListSessionsResponse>

### unstable\_resumeSession

- unstable\_resumeSession (  
	params:[ResumeSessionRequest](https://agentclientprotocol.github.io/typescript-sdk/types/ResumeSessionRequest.html),  
	):Promise < [ResumeSessionResponse](https://agentclientprotocol.github.io/typescript-sdk/types/ResumeSessionResponse.html) \>
	`Experimental`
	**UNSTABLE**
	This capability is not part of the spec yet, and may be removed or changed at any point.
	Resumes an existing session without returning previous messages.
	This method is only available if the agent advertises the `session.resume` capability.
	The agent should resume the session context, allowing the conversation to continue without replaying the message history (unlike `session/load`).
	#### Parameters
	- params: [ResumeSessionRequest](https://agentclientprotocol.github.io/typescript-sdk/types/ResumeSessionRequest.html)
	#### Returns Promise<ResumeSessionResponse>

### setSessionMode

- Sets the operational mode for a session.
	Allows switching between different agent modes (e.g., "ask", "architect", "code") that affect system prompts, tool availability, and permission behaviors.
	The mode must be one of the modes advertised in `availableModes` during session creation or loading. Agents may also change modes autonomously and notify the client via `current_mode_update` notifications.
	This method can be called at any time during a session, whether the Agent is idle or actively generating a turn.
	See protocol docs: [Session Modes](https://agentclientprotocol.com/protocol/session-modes)
	#### Parameters
	- params: [SetSessionModeRequest](https://agentclientprotocol.github.io/typescript-sdk/types/SetSessionModeRequest.html)
	#### Returns Promise<SetSessionModeResponse>

### unstable\_setSessionModel

- unstable\_setSessionModel (  
	params:[SetSessionModelRequest](https://agentclientprotocol.github.io/typescript-sdk/types/SetSessionModelRequest.html),  
	):Promise < [SetSessionModelResponse](https://agentclientprotocol.github.io/typescript-sdk/types/SetSessionModelResponse.html) \>
	`Experimental`
	**UNSTABLE**
	This capability is not part of the spec yet, and may be removed or changed at any point.
	Select a model for a given session.
	#### Parameters
	- params: [SetSessionModelRequest](https://agentclientprotocol.github.io/typescript-sdk/types/SetSessionModelRequest.html)
	#### Returns Promise<SetSessionModelResponse>

### authenticate

- Authenticates the client using the specified authentication method.
	Called when the agent requires authentication before allowing session creation. The client provides the authentication method ID that was advertised during initialization.
	After successful authentication, the client can proceed to create sessions with `newSession` without receiving an `auth_required` error.
	See protocol docs: [Initialization](https://agentclientprotocol.com/protocol/initialization)
	#### Parameters
	- params: [AuthenticateRequest](https://agentclientprotocol.github.io/typescript-sdk/types/AuthenticateRequest.html)
	#### Returns Promise<AuthenticateResponse>

### prompt

- Processes a user prompt within a session.
	This method handles the whole lifecycle of a prompt:
	- Receives user messages with optional context (files, images, etc.)
	- Processes the prompt using language models
	- Reports language model content and tool calls to the Clients
	- Requests permission to run tools
	- Executes any requested tool calls
	- Returns when the turn is complete with a stop reason
	See protocol docs: [Prompt Turn](https://agentclientprotocol.com/protocol/prompt-turn)
	#### Parameters
	- params: [PromptRequest](https://agentclientprotocol.github.io/typescript-sdk/types/PromptRequest.html)
	#### Returns Promise<PromptResponse>

### cancel

- Cancels ongoing operations for a session.
	This is a notification sent by the client to cancel an ongoing prompt turn.
	Upon receiving this notification, the Agent SHOULD:
	- Stop all language model requests as soon as possible
	- Abort all tool call invocations in progress
	- Send any pending `session/update` notifications
	- Respond to the original `session/prompt` request with `StopReason::Cancelled`
	See protocol docs: [Cancellation](https://agentclientprotocol.com/protocol/prompt-turn#cancellation)
	#### Parameters
	- params: [CancelNotification](https://agentclientprotocol.github.io/typescript-sdk/types/CancelNotification.html)
	#### Returns Promise<void>

### extMethod

- extMethod (  
	method:string,  
	params:Record < string,unknown \>,  
	):Promise < Record < string,unknown \> \>
	Extension method
	Allows the Client to send an arbitrary request that is not part of the ACP spec.
	#### Parameters
	- method: string
	- params: Record < string,unknown \>
	#### Returns Promise<Record<string, unknown>>

### extNotification

- extNotification (method:string,params:Record < string,unknown \>):Promise < void \>
	Extension notification
	Allows the Client to send an arbitrary notification that is not part of the ACP spec.
	#### Parameters
	- method: string
	- params: Record < string,unknown \>