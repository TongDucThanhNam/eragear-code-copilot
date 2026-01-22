[![Contributors][contributors-shield]][contributors-url]
[![Forks][forks-shield]][forks-url]
[![Stargazers][stars-shield]][stars-url]
[![Issues][issues-shield]][issues-url]
[![MIT License][license-shield]][license-url]

<div align="center">
  <h1>Eragear Code Copilot</h1>
  <p>
    A web-based AI coding assistant built on the Agent Client Protocol (ACP), bridging
    a browser-based UI with local AI agents capable of filesystem manipulation and
    terminal command execution.
  </p>
  <p>
    <a href="#about-the-project">About</a> ·
    <a href="#features">Features</a> ·
    <a href="#architecture">Architecture</a> ·
    <a href="#getting-started">Getting Started</a> ·
    <a href="#contributing">Contributing</a> ·
    <a href="#license">License</a>
  </p>
</div>

## About The Project

Eragear Code Copilot is a web-based AI coding assistant built on the **Agent Client Protocol (ACP)**.
It provides a bridge between a browser-based UI and local AI agents capable of manipulating the
filesystem and running terminal commands.

The system consists of three main components:
- **Frontend**: React-based UI with Tailwind CSS and Shadcn UI components
- **Backend**: Hono server handling ACP communication and tRPC Subscriptions
- **Shared Workspace**: Shared types, event schemas, and protocol helpers

## Features

- **Real-time Communication**: tRPC Subscriptions (WebSocket) for streaming agent responses
- **Session Management**: Create, manage, and switch between multiple chat sessions
- **Project-scoped Sessions**: Each ACP session belongs to a project
- **Active/Inactive Sessions**: 
  - **Active**: Live ACP connection, full interaction capability
  - **Inactive**: History viewing; can be resumed if the agent supports ACP session resume
- **Message Persistence**: Chat history is saved server-side for later viewing
- **Agent Configuration**: Add and configure local AI agents through the Settings dialog
- **Responsive UI**: Modern interface with chat messages, input, and session controls
- **Multi-platform**: Web (`apps/web`) and Mobile (`apps/native`) clients
- **Persistence**: Zustand stores with LocalStorage/AsyncStorage for agent configurations
- **Project Management**: Create/select projects (stored server-side) for both Web & Mobile
- **Authentication**: Better-Auth integration (currently mocked for local development)

## Architecture

The system follows a 3-tier architecture that clearly distinguishes roles according to the **Agent Client Protocol (ACP)** definitions:

### 1. Client (User Interface)
*   **Role**: The user-facing interface.
*   **Implementations**: Web App (`apps/web`), and future Desktop/Mobile apps.
*   **Responsibilities**: Rendering UI, capturing user input, displaying agent stream.

### 2. Server (ACP Client)
*   **Role**: Acts as the **Client** in the ACP context. It manages the connection to the Agent.
*   **Implementation**: Hono Server (`apps/server`).
*   **Responsibilities**:
    *   Spawning and managing the Agent process.
    *   Bridging communication between the UI and the Agent.
    *   Providing system capabilities (File System access, Terminal execution) to the Agent.

### 3. Agents (ACP Agents)
*   **Role**: The intelligent backend process that performs tasks.
*   **Implementations**: Claude Code, Codex, OpenCode, Gemini CLI.
*   **Responsibilities**: Reasoning, executing tool calls using Server capabilities, and generating code.

## Getting Started

### Prerequisites

- Bun 1.0+ or Node.js 20+
- Local AI agent configured for ACP communication

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/eragear/eragear-code-copilot
   cd eragear-code-copilot
   ```

2. Install dependencies:
   ```bash
   bun install
   ```

3. Start the development server:
   ```bash
   bun run dev
   ```

This starts the backend on `:3000` and frontend on `:3001`.

### Adding a New Agent

1. Open the **Settings** dialog in the Web UI
2. Provide a Name, Command (e.g., `opencode`), Args (e.g., `acp`), and Environment variables
3. Configuration is saved to `LocalStorage` and passed to the server when starting a chat

## Important Notes

### Session Lifecycle

This project uses the **Agent Client Protocol (ACP)** with support for session resume when the agent advertises it.

1. **Two Types of Sessions**:
   - **Client Session** (`chatId`): Connection between UI and Server via tRPC/WebSocket
   - **ACP Session** (`sessionId`): Connection between Server and ACP Agent via stdio

2. **Session States**:
   | State | Description | User Action |
   |-------|-------------|-------------|
   | Active | ACP session alive | Full chat interaction |
   | Inactive | ACP session ended | Resume if supported, otherwise read-only |

3. **Session Resume**: If the agent supports `loadSession`, the server can resume an inactive session using its stored `sessionId`.

4. **Message Persistence**: Messages are saved to `.eragear/sessions.json` on the server for history viewing and resume.

### Project Roots

Project paths are validated against `projectRoots` in server settings. Ensure at least one allowed root is configured before creating projects or sessions.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

MIT © Eragear Code Copilot

## Contact

- Repository: [eragear/eragear-code-copilot](https://github.com/eragear/eragear-code-copilot)

[contributors-shield]: https://img.shields.io/github/contributors/eragear/eragear-code-copilot?style=for-the-badge
[contributors-url]: https://github.com/eragear/eragear-code-copilot/graphs/contributors
[forks-shield]: https://img.shields.io/github/forks/eragear/eragear-code-copilot?style=for-the-badge
[forks-url]: https://github.com/eragear/eragear-code-copilot/network/members
[stars-shield]: https://img.shields.io/github/stars/eragear/eragear-code-copilot?style=for-the-badge
[stars-url]: https://github.com/eragear/eragear-code-copilot/stargazers
[issues-shield]: https://img.shields.io/github/issues/eragear/eragear-code-copilot?style=for-the-badge
[issues-url]: https://github.com/eragear/eragear-code-copilot/issues
[license-shield]: https://img.shields.io/github/license/eragear/eragear-code-copilot?style=for-the-badge
[license-url]: https://github.com/eragear/eragear-code-copilot/blob/main/LICENSE
