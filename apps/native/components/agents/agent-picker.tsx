import { Ionicons } from "@expo/vector-icons";
import { ListGroup, RadioGroup, useThemeColor } from "heroui-native";
import type { Agent } from "@/store/settings-store";
import { AgentIcon } from "./agent-icons";

interface AgentPickerProps {
  agents: Agent[];
  activeAgentId?: string | null;
  onSelect: (agentId: string) => void;
  isLoading?: boolean;
  emptyLabel?: string;
}

export function AgentPicker({
  agents,
  activeAgentId,
  onSelect,
  isLoading = false,
  emptyLabel = "No agents configured.",
}: AgentPickerProps) {
  const themeColorForeground = useThemeColor("foreground");
  const themeColorMuted = useThemeColor("muted");
  const themeColorSuccess = useThemeColor("success");

  if (agents.length === 0) {
    return (
      <ListGroup>
        <ListGroup.Item>
          <ListGroup.ItemContent>
            <ListGroup.ItemDescription className="text-muted-foreground">
              {emptyLabel}
            </ListGroup.ItemDescription>
          </ListGroup.ItemContent>
        </ListGroup.Item>
      </ListGroup>
    );
  }

  return (
    <RadioGroup
      value={activeAgentId ?? ""}
      onValueChange={onSelect}
      isDisabled={isLoading}
    >
      {agents.map((agent: Agent) => (
        <RadioGroup.Item key={agent.id} value={agent.id}>
          <ListGroup.Item>
            <ListGroup.ItemPrefix>
              <AgentIcon
                color={themeColorForeground}
                secondaryColor={themeColorMuted}
                size={20}
                type={agent.type}
              />
            </ListGroup.ItemPrefix>
            <ListGroup.ItemContent>
              <ListGroup.ItemTitle>{agent.name}</ListGroup.ItemTitle>
              <ListGroup.ItemDescription>
                {agent.type} • {agent.command}
              </ListGroup.ItemDescription>
            </ListGroup.ItemContent>
            <ListGroup.ItemSuffix>
              {activeAgentId === agent.id && (
                <Ionicons
                  color={themeColorSuccess}
                  name="checkmark-circle"
                  size={20}
                />
              )}
            </ListGroup.ItemSuffix>
          </ListGroup.Item>
        </RadioGroup.Item>
      ))}
    </RadioGroup>
  );
}
