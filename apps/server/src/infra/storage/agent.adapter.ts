// Agent storage adapter
import { readJsonFile, writeJsonFile } from './json-store';
import type { AgentRepositoryPort } from '../../shared/types/ports';
import type { AgentConfig, AgentInput, AgentUpdateInput } from '../../shared/types/agent.types';

const AGENTS_FILE = 'agents.json';

export class AgentStorageAdapter implements AgentRepositoryPort {
  private getAgentsData(): { agents: AgentConfig[]; activeAgentId: string | null } {
    const fallback = {
      agents: [
        {
          id: 'default-opencode',
          name: 'Default (Opencode)',
          type: 'opencode' as const,
          command: 'opencode',
          args: ['acp'],
          env: {},
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ],
      activeAgentId: 'default-opencode',
    };
    return readJsonFile(AGENTS_FILE, fallback);
  }

  private saveAgentsData(data: { agents: AgentConfig[]; activeAgentId: string | null }): void {
    writeJsonFile(AGENTS_FILE, data);
  }

  findById(id: string): AgentConfig | undefined {
    const data = this.getAgentsData();
    return data.agents.find((a) => a.id === id);
  }

  findAll(): AgentConfig[] {
    const data = this.getAgentsData();
    return data.agents;
  }

  listByProject(projectId?: string | null): AgentConfig[] {
    const data = this.getAgentsData();
    if (projectId === undefined) {
      return data.agents;
    }
    return data.agents.filter((a) => !a.projectId || a.projectId === projectId);
  }

  create(input: AgentInput): AgentConfig {
    const data = this.getAgentsData();
    const name = input.name.trim();

    if (!name) {
      throw new Error('Agent name is required');
    }

    const now = Date.now();
    const newAgent: AgentConfig = {
      id: crypto.randomUUID?.() || `agent-${Date.now()}`,
      name,
      type: input.type,
      command: input.command,
      args: input.args,
      env: input.env,
      projectId: input.projectId,
      createdAt: now,
      updatedAt: now,
    };

    data.agents.push(newAgent);

    if (!data.activeAgentId) {
      data.activeAgentId = newAgent.id;
    }

    this.saveAgentsData(data);
    return newAgent;
  }

  update(input: AgentUpdateInput): AgentConfig {
    const data = this.getAgentsData();
    const index = data.agents.findIndex((a) => a.id === input.id);

    if (index === -1) {
      throw new Error('Agent not found');
    }

    const current = data.agents[index]!;

    const updated: AgentConfig = {
      ...current,
      name: input.name?.trim() || current.name,
      type: input.type || current.type,
      command: input.command || current.command,
      args: input.args !== undefined ? input.args : current.args,
      env: input.env !== undefined ? input.env : current.env,
      updatedAt: Date.now(),
    };

    data.agents[index] = updated;
    this.saveAgentsData(data);
    return updated;
  }

  delete(id: string): void {
    const data = this.getAgentsData();
    const newAgents = data.agents.filter((a) => a.id !== id);

    let newActiveId = data.activeAgentId;
    if (data.activeAgentId === id) {
      newActiveId = newAgents.length > 0 ? newAgents[0]!.id : null;
    }

    this.saveAgentsData({
      agents: newAgents,
      activeAgentId: newActiveId,
    });
  }

  setActive(id: string | null): void {
    const data = this.getAgentsData();
    if (id) {
      const exists = data.agents.some((a) => a.id === id);
      if (!exists) {
        throw new Error('Agent not found');
      }
    }

    data.activeAgentId = id;
    this.saveAgentsData(data);
  }
}
