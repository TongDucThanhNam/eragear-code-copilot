"use client";

import {
  Check,
  Edit2,
  Globe,
  Plus,
  Terminal,
  Trash2,
} from "lucide-react";
import React from "react";
import { toast } from "sonner";
import { renderAgentIcon } from "@/components/left-sidebar/agent-icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DEFAULT_SERVER_URL } from "@/lib/server-url";
import { trpc } from "@/lib/trpc";
import { useServerConfigStore } from "@/store/server-config-store";

type AgentType = "claude" | "codex" | "opencode" | "gemini" | "other";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  // Server Connection State
  const { serverUrl, apiKey, setServerUrl, setApiKey } = useServerConfigStore();

  // Sub-Dialog State (Add/Edit)
  const [isEditOpen, setIsEditOpen] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [formData, setFormData] = React.useState<{
    name: string;
    type: AgentType;
    command: string;
    args: string;
    resumeCommandTemplate: string;
    env: string;
  }>({
    name: "",
    type: "opencode",
    command: "",
    args: "",
    resumeCommandTemplate: "",
    env: "{}",
  });

  const utils = trpc.useUtils();
  const { data: agentsData, isLoading } = trpc.agents.list.useQuery();
  const activeAgentId = agentsData?.activeAgentId ?? null;
  const agents = agentsData?.agents ?? [];

  const createAgentMutation = trpc.agents.create.useMutation({
    onSuccess: async () => {
      await utils.agents.list.invalidate();
      setIsEditOpen(false);
      toast.success("Agent created");
    },
    onError: (err) => {
      toast.error(err.message || "Failed to create agent");
    },
  });

  const updateAgentMutation = trpc.agents.update.useMutation({
    onSuccess: async () => {
      await utils.agents.list.invalidate();
      setIsEditOpen(false);
      toast.success("Agent updated");
    },
    onError: (err) => {
      toast.error(err.message || "Failed to update agent");
    },
  });

  const deleteAgentMutation = trpc.agents.delete.useMutation({
    onSuccess: async () => {
      await utils.agents.list.invalidate();
      toast.success("Agent deleted");
    },
    onError: (err) => {
      toast.error(err.message || "Failed to delete agent");
    },
  });

  const setActiveAgentMutation = trpc.agents.setActive.useMutation({
    onSuccess: async () => {
      await utils.agents.list.invalidate();
      toast.success("Active agent updated");
    },
    onError: (err) => {
      toast.error(err.message || "Failed to update active agent");
    },
  });

  const handleDelete = (id: string) => {
    deleteAgentMutation.mutate({ id });
  };

  const handleEdit = (id: string) => {
    const agent = agents.find((item) => item.id === id);
    if (!agent) {
      toast.error("Agent not found");
      return;
    }
    setEditingId(id);
    setFormData({
      name: agent.name,
      type: agent.type,
      command: agent.command,
      args: (agent.args || []).join(" "),
      resumeCommandTemplate: agent.resumeCommandTemplate ?? "",
      env: JSON.stringify(agent.env || {}, null, 2),
    });
    setIsEditOpen(true);
  };

  const handleAddNew = () => {
    setEditingId(null);
    setFormData({
      name: "",
      type: "opencode",
      command: "",
      args: "",
      resumeCommandTemplate: "",
      env: "{}",
    });
    setIsEditOpen(true);
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    try {
      const envRaw = JSON.parse(formData.env);
      const envParsed =
        envRaw && typeof envRaw === "object" && !Array.isArray(envRaw)
          ? Object.fromEntries(
              Object.entries(envRaw).map(([key, value]) => [key, String(value)])
            )
          : null;

      if (!envParsed) {
        toast.error("ENV must be a JSON object");
        return;
      }

      const payload = {
        name: formData.name.trim(),
        type: formData.type,
        command: formData.command.trim(),
        args: formData.args.split(" ").filter(Boolean),
        resumeCommandTemplate:
          formData.resumeCommandTemplate.trim() || undefined,
        env: envParsed,
      };

      if (editingId) {
        updateAgentMutation.mutate({ id: editingId, ...payload });
      } else {
        createAgentMutation.mutate(payload);
      }
    } catch (err) {
      console.error("Save error:", err);
      toast.error("Invalid ENV JSON");
    }
  };

  const getAgentIcon = (type: string, name?: string) =>
    renderAgentIcon({ agentType: type, agentName: name }, "h-4 w-4");

  return (
    <>
      <Dialog onOpenChange={onOpenChange} open={open}>
        <DialogContent className="max-h-[80vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Settings</DialogTitle>
            <DialogDescription>
              Manage your ACP agent configurations. These are saved on the
              server.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6">
            {/* Server Connection Section */}
            <div className="rounded-lg border p-4">
              <h3 className="mb-3 flex items-center gap-2 font-medium">
                <Globe className="h-4 w-4" /> Server Connection
              </h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label className="text-xs" htmlFor="serverUrl">
                    Server URL
                  </Label>
                  <Input
                    id="serverUrl"
                    onChange={(e) => setServerUrl(e.target.value)}
                    placeholder={DEFAULT_SERVER_URL}
                    value={serverUrl}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs" htmlFor="apiKey">
                    API Key
                  </Label>
                  <Input
                    id="apiKey"
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="eg_xxxxxxxxxxxxx"
                    type="password"
                    value={apiKey}
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end">
              <Button onClick={handleAddNew} size="sm">
                <Plus className="mr-2 h-4 w-4" /> Add Agent
              </Button>
            </div>

            <div className="grid gap-4">
              {isLoading && (
                <div className="col-span-full rounded-lg border border-dashed p-8 text-center text-muted-foreground">
                  Loading agents...
                </div>
              )}

              {!isLoading &&
                agents.map((agent) => {
                  const isActive = activeAgentId === agent.id;
                  const args = agent.args || [];
                  return (
                    <Card
                      className={`flex flex-col transition-all ${
                        isActive ? "border-primary ring-1 ring-primary" : ""
                      }`}
                      key={agent.id}
                    >
                      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <div className="flex items-center gap-2">
                          <div className="shrink-0 rounded-md bg-muted p-2">
                            {getAgentIcon(agent.type, agent.name)}
                          </div>
                          <CardTitle className="font-medium text-base">
                            {agent.name}
                          </CardTitle>
                          {isActive && (
                            <Badge
                              className="h-5 px-1.5 text-[10px]"
                              variant="default"
                            >
                              Active
                            </Badge>
                          )}
                        </div>
                        <div className="flex gap-1">
                          <Button
                            className="h-8 w-8"
                            onClick={() => handleEdit(agent.id)}
                            size="icon"
                            variant="ghost"
                          >
                            <Edit2 className="h-3 w-3" />
                          </Button>
                          <Button
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            disabled={isActive}
                            onClick={() => handleDelete(agent.id)}
                            size="icon"
                            title={
                              isActive
                                ? "Cannot delete active agent"
                                : "Delete agent"
                            }
                            variant="ghost"
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </CardHeader>
                      <CardContent className="flex flex-1 flex-col justify-between gap-4 pt-2">
                        <div className="flex flex-col gap-2">
                          <code className="flex items-center gap-1 overflow-hidden text-ellipsis whitespace-nowrap rounded bg-muted p-1 text-xs">
                            <Terminal className="inline h-3 w-3 shrink-0" />
                            {agent.command} {args.join(" ")}
                          </code>
                          <div className="flex gap-2">
                            <Badge
                              className="h-5 text-[10px]"
                              variant="secondary"
                            >
                              {agent.type}
                            </Badge>
                            {agent.env && Object.keys(agent.env).length > 0 && (
                              <Badge
                                className="h-5 text-[10px]"
                                variant="outline"
                              >
                                {Object.keys(agent.env).length} ENV
                              </Badge>
                            )}
                          </div>
                        </div>

                        {!isActive && (
                          <Button
                            className="w-full"
                            onClick={() =>
                              setActiveAgentMutation.mutate({ id: agent.id })
                            }
                            size="sm"
                            variant="outline"
                          >
                            <Check className="mr-2 h-3.5 w-3.5" />
                            Use This Agent
                          </Button>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}

              {!isLoading && agents.length === 0 && (
                <div className="col-span-full rounded-lg border border-dashed p-8 text-center text-muted-foreground">
                  No agents configured.
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Nested Dialog for Editing */}
      <Dialog onOpenChange={setIsEditOpen} open={isEditOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <form onSubmit={handleFormSubmit}>
            <DialogHeader>
              <DialogTitle>
                {editingId ? "Edit Agent" : "Add Agent"}
              </DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  onChange={(e) =>
                    setFormData({ ...formData, name: e.target.value })
                  }
                  placeholder="My Agent"
                  required
                  value={formData.name}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="type">Type</Label>
                  <Select
                    onValueChange={(v: string) => {
                      const validTypes: AgentType[] = [
                        "claude",
                        "codex",
                        "opencode",
                        "gemini",
                        "other",
                      ];
                      if (validTypes.includes(v as AgentType)) {
                        setFormData({
                          ...formData,
                          type: v as AgentType,
                        });
                      }
                    }}
                    value={formData.type}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="claude">Claude code</SelectItem>
                      <SelectItem value="codex">Codex</SelectItem>
                      <SelectItem value="opencode">OpenCode</SelectItem>
                      <SelectItem value="gemini">Gemini CLI</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="cmd">Command</Label>
                  <Input
                    id="cmd"
                    onChange={(e) =>
                      setFormData({ ...formData, command: e.target.value })
                    }
                    placeholder="opencode"
                    required
                    value={formData.command}
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="args">Arguments</Label>
                <Input
                  id="args"
                  onChange={(e) =>
                    setFormData({ ...formData, args: e.target.value })
                  }
                  placeholder="acp"
                  value={formData.args}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="resume-command-template">
                  Resume Command Template
                </Label>
                <Input
                  id="resume-command-template"
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      resumeCommandTemplate: e.target.value,
                    })
                  }
                  placeholder="codex resume <sessionId>"
                  value={formData.resumeCommandTemplate}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="env">Environment (JSON)</Label>
                <Input
                  className="font-mono text-xs"
                  id="env"
                  onChange={(e) =>
                    setFormData({ ...formData, env: e.target.value })
                  }
                  placeholder="{}"
                  value={formData.env}
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                onClick={() => setIsEditOpen(false)}
                type="button"
                variant="ghost"
              >
                Cancel
              </Button>
              <Button type="submit">Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
