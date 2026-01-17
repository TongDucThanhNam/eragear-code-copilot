"use client";

import {
  Check,
  Code2,
  Cpu,
  Edit2,
  Folder,
  MessageSquare,
  Plus,
  Sparkles,
  Terminal,
  Trash2,
} from "lucide-react";
import React from "react";
import { toast } from "sonner";
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
import { type AgentConfig, useSettingsStore } from "@/store/settings-store";

export function SettingsDialog() {
  const {
    isOpen,
    setIsOpen,
    settings,
    setSettings,
    activeAgentId,
    setActiveAgentId,
  } = useSettingsStore();

  // Sub-Dialog State (Add/Edit)
  const [isEditOpen, setIsEditOpen] = React.useState(false);
  const [editingName, setEditingName] = React.useState<string | null>(null);
  const [formData, setFormData] = React.useState<{
    name: string;
    type: "claude" | "codex" | "opencode" | "gemini" | "other";
    command: string;
    args: string;
    env: string;
    cwd: string;
  }>({
    name: "",
    type: "opencode",
    command: "",
    args: "",
    env: "{}",
    cwd: "",
  });

  const handleDelete = (name: string) => {
    const newAgents = { ...settings.agent_servers };
    delete newAgents[name];
    setSettings({ ...settings, agent_servers: newAgents });

    if (activeAgentId === name) {
      setActiveAgentId(Object.keys(newAgents)[0] || null);
    }
  };

  const handleEdit = (name: string) => {
    const agent = settings.agent_servers[name];
    setEditingName(name);
    setFormData({
      name,
      type: agent.type,
      command: agent.command,
      args: (agent.args || []).join(" "),
      env: JSON.stringify(agent.env || {}, null, 2),
      cwd: agent.cwd || "",
    });
    setIsEditOpen(true);
  };

  const handleAddNew = () => {
    setEditingName(null);
    setFormData({
      name: "",
      type: "opencode",
      command: "",
      args: "",
      env: "{}",
      cwd: "",
    });
    setIsEditOpen(true);
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    try {
      const envParsed = JSON.parse(formData.env);
      const newAgent = {
        type: formData.type,
        command: formData.command,
        args: formData.args.split(" ").filter(Boolean),
        env: envParsed,
        cwd: formData.cwd || undefined,
      };

      const newAgents = { ...settings.agent_servers };

      if (editingName && editingName !== formData.name) {
        delete newAgents[editingName];
        // If we renamed the active agent, update the ID
        if (activeAgentId === editingName) {
          setActiveAgentId(formData.name);
        }
      }

      newAgents[formData.name] = newAgent;

      setSettings({ ...settings, agent_servers: newAgents });

      // If no active agent, set this one
      if (!activeAgentId) {
        setActiveAgentId(formData.name);
      }

      setIsEditOpen(false);
      toast.success("Settings saved locally");
    } catch (err) {
      console.error("Save error:", err);
      toast.error("Invalid ENV JSON");
    }
  };

  const agents = settings.agent_servers || {};

  const getAgentIcon = (type: string) => {
    switch (type) {
      case "claude":
        return <MessageSquare className="h-4 w-4" />;
      case "codex":
        return <Cpu className="h-4 w-4" />;
      case "opencode":
        return <Code2 className="h-4 w-4" />;
      case "gemini":
        return <Sparkles className="h-4 w-4" />;
      default:
        return <Terminal className="h-4 w-4" />;
    }
  };

  return (
    <>
      <Dialog onOpenChange={setIsOpen} open={isOpen}>
        <DialogContent className="max-h-[80vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Settings</DialogTitle>
            <DialogDescription>
              Manage your ACP agent configurations. These are saved in your
              browser.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6">
            <div className="flex justify-end">
              <Button onClick={handleAddNew} size="sm">
                <Plus className="mr-2 h-4 w-4" /> Add Agent
              </Button>
            </div>

            <div className="grid gap-4">
              {Object.entries(agents).map(([name, config]) => {
                const isActive = activeAgentId === name;
                return (
                  <Card
                    className={`flex flex-col transition-all ${
                      isActive ? "border-primary ring-1 ring-primary" : ""
                    }`}
                    key={name}
                  >
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                      <div className="flex items-center gap-2">
                        <div className="shrink-0 rounded-md bg-muted p-2">
                          {getAgentIcon(config.type)}
                        </div>
                        <CardTitle className="font-medium text-base">
                          {name}
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
                          onClick={() => handleEdit(name)}
                          size="icon"
                          variant="ghost"
                        >
                          <Edit2 className="h-3 w-3" />
                        </Button>
                        <Button
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          disabled={isActive}
                          onClick={() => handleDelete(name)}
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
                          {config.command} {(config.args || []).join(" ")}
                        </code>
                        <div className="flex gap-2">
                          <Badge
                            className="h-5 text-[10px]"
                            variant="secondary"
                          >
                            {config.type}
                          </Badge>
                          {config.cwd && (
                            <Badge
                              className="flex h-5 items-center gap-1 text-[10px]"
                              variant="outline"
                            >
                              <Folder className="h-2 w-2" />
                              {config.cwd}
                            </Badge>
                          )}
                          {config.env && Object.keys(config.env).length > 0 && (
                            <Badge
                              className="h-5 text-[10px]"
                              variant="outline"
                            >
                              {Object.keys(config.env).length} ENV
                            </Badge>
                          )}
                        </div>
                      </div>

                      {!isActive && (
                        <Button
                          className="w-full"
                          onClick={() => setActiveAgentId(name)}
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

              {Object.keys(agents).length === 0 && (
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
                {editingName ? "Edit Agent" : "Add Agent"}
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
                      const validTypes: AgentConfig["type"][] = [
                        "claude",
                        "codex",
                        "opencode",
                        "gemini",
                        "other",
                      ];
                      if (validTypes.includes(v as AgentConfig["type"])) {
                        setFormData({
                          ...formData,
                          type: v as AgentConfig["type"],
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
                <Label htmlFor="cwd">Working Directory (CWD)</Label>
                <Input
                  id="cwd"
                  onChange={(e) =>
                    setFormData({ ...formData, cwd: e.target.value })
                  }
                  placeholder="/path/to/project"
                  value={formData.cwd}
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
