import type * as acp from "@agentclientprotocol/sdk";
import type { SettingsRepositoryPort } from "@/modules/settings";
import { ValidationError } from "@/shared/errors";
import type {
  McpHttpServerConfig,
  McpServerConfig,
  McpSseServerConfig,
  McpStdioServerConfig,
} from "@/shared/types/settings.types";

const OP = "session.lifecycle.create";

interface AgentMcpCapabilities {
  mcpCapabilities?: { http?: boolean; sse?: boolean };
  mcp?: { http?: boolean; sse?: boolean };
}

export class SessionMcpConfigService {
  private readonly settingsRepo: SettingsRepositoryPort;

  constructor(settingsRepo: SettingsRepositoryPort) {
    this.settingsRepo = settingsRepo;
  }

  toAcpServers(mcpServers: McpServerConfig[]): acp.McpServer[] {
    return mcpServers.map((server) => {
      if (this.isHttpServer(server)) {
        return {
          type: "http" as const,
          name: server.name,
          url: server.url,
          headers: server.headers,
        } satisfies acp.McpServer;
      }

      if (this.isSseServer(server)) {
        return {
          type: "sse" as const,
          name: server.name,
          url: server.url,
          headers: server.headers,
        } satisfies acp.McpServer;
      }

      const stdio = server as McpStdioServerConfig;
      return {
        name: stdio.name,
        command: stdio.command,
        args: stdio.args ?? [],
        env: stdio.env ?? [],
      } satisfies acp.McpServer;
    });
  }

  async resolveServers(
    agentCapabilities?: AgentMcpCapabilities
  ): Promise<McpServerConfig[]> {
    const { mcpServers } = await this.settingsRepo.get();
    if (!mcpServers || mcpServers.length === 0) {
      return [];
    }

    const mcpCaps =
      agentCapabilities?.mcpCapabilities ?? agentCapabilities?.mcp;
    const httpSupported = Boolean(mcpCaps?.http);
    const sseSupported = Boolean(mcpCaps?.sse);

    const blocked = mcpServers.filter((server) => {
      if (this.isHttpServer(server)) {
        return !httpSupported;
      }
      if (this.isSseServer(server)) {
        return !sseSupported;
      }
      return false;
    });

    if (blocked.length > 0) {
      const blockedNames = blocked.map((server) => server.name).join(", ");
      throw new ValidationError(
        `Agent does not support MCP transports for: ${blockedNames}`,
        {
          module: "session",
          op: OP,
          details: { blockedNames },
        }
      );
    }

    return mcpServers;
  }

  private isHttpServer(server: McpServerConfig): server is McpHttpServerConfig {
    return "type" in server && server.type === "http";
  }

  private isSseServer(server: McpServerConfig): server is McpSseServerConfig {
    return "type" in server && server.type === "sse";
  }
}
