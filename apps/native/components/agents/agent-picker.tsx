import { Ionicons } from "@expo/vector-icons";
import { Pressable, ScrollView, Text, View } from "react-native";
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
  if (agents.length === 0) {
    return <Text className="text-sm text-zinc-400">{emptyLabel}</Text>;
  }

  return (
    <ScrollView>
      {agents.map((agent: Agent) => (
        <Pressable
          className="mb-3 rounded-xl border border-zinc-700 p-4"
          disabled={isLoading}
          key={agent.id}
          onPress={() => onSelect(agent.id)}
        >
          <View className="flex-row items-center justify-between">
            <View className="flex-1 flex-row items-center gap-3">
              <AgentIcon
                color="#f8fafc"
                secondaryColor="#94a3b8"
                size={20}
                type={agent.type}
              />
              <View className="flex-1">
                <Text className="font-semibold text-white">{agent.name}</Text>
                <Text className="mt-1 text-xs text-zinc-400">
                  {agent.type} • {agent.command}
                </Text>
              </View>
            </View>
            {activeAgentId === agent.id ? (
              <Ionicons color="#22c55e" name="checkmark-circle" size={18} />
            ) : null}
          </View>
        </Pressable>
      ))}
    </ScrollView>
  );
}
