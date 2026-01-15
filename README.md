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
- **Backend**: Hono server handling ACP communication and SSE streaming
- **Shared Workspace**: Shared types, event schemas, and protocol helpers

## Features

- **Real-time Communication**: Server-Sent Events (SSE) for streaming agent responses
- **Session Management**: Create, manage, and switch between multiple chat sessions
- **Agent Configuration**: Add and configure local AI agents through the Settings dialog
- **Responsive UI**: Modern interface with chat messages, input, and session controls
- **Persistence**: Zustand stores with LocalStorage for agent configurations
- **Authentication**: Better-Auth integration (currently mocked for local development)

## Architecture

### Backend (`apps/server`)
- **Runtime**: Bun / Node.js
- **Framework**: Hono
- **Core Library**: `@agentclientprotocol/sdk`
- **Communication**:
  - Frontend → Backend: REST APIs (JSON) for initialization and prompt submission
  - Backend → Agent: Standard Input/Output (ndjson) via `node:child_process`
  - Backend → Frontend: Server-Sent Events (SSE) for real-time streaming
- **SSE Features**: Heartbeats every 15s, automatic cleanup on agent exit

### Frontend (`apps/web`)
- **Framework**: React 18+ (Vite)
- **Styling**: Tailwind CSS + Shadcn UI
- **Icons**: Lucide React
- **Routing**: TanStack Router
- **State Management**: Zustand with `persist` middleware
- **Authentication**: Better-Auth (mocked for development)

### Shared Workspace
- `packages/shared`: Shared types, event schemas, and protocol helpers
- `packages/runner`: CLI wrapper for running ACP agents in batch mode

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
