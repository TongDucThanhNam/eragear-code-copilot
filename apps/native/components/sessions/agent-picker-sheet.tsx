import { Ionicons } from "@expo/vector-icons";
import { BottomSheet } from "heroui-native";
import { View } from "react-native";
import { AgentPicker } from "@/components/agents/agent-picker";
import type { Agent } from "@/store/settings-store";

interface AgentPickerSheetProps {
  activeAgentId?: string | null;
  agents: Agent[];
  isLoading: boolean;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectAgent: (agentId: string) => void;
}

export function AgentPickerSheet({
  activeAgentId,
  agents,
  isLoading,
  isOpen,
  onOpenChange,
  onSelectAgent,
}: AgentPickerSheetProps) {
  return (
    <BottomSheet isOpen={isOpen} onOpenChange={onOpenChange}>
      <BottomSheet.Portal>
        <BottomSheet.Overlay />
        <BottomSheet.Content
          className="rounded-t-3xl"
          snapPoints={["50%", "70%"]}
        >
          <View className="flex-1 p-6">
            <View className="mb-4 flex-row items-center justify-between">
              <View>
                <BottomSheet.Title className="font-semibold text-foreground text-lg">
                  Select Agent
                </BottomSheet.Title>
                <BottomSheet.Description className="text-muted-foreground text-sm">
                  Choose an agent to start a new session
                </BottomSheet.Description>
              </View>
              <BottomSheet.Close hitSlop={12}>
                <Ionicons color="#94a3b8" name="close" size={20} />
              </BottomSheet.Close>
            </View>

            <AgentPicker
              activeAgentId={activeAgentId}
              agents={agents}
              emptyLabel="No agents configured."
              isLoading={isLoading}
              onSelect={onSelectAgent}
            />
          </View>
        </BottomSheet.Content>
      </BottomSheet.Portal>
    </BottomSheet>
  );
}
