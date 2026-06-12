import { createFileRoute } from "@tanstack/react-router";
import { PromptEnhancementSettingsPanel } from "@/components/settings/prompt-enhancement-settings-panel";

export const Route = createFileRoute("/settings/prompt-enhancement")({
  component: PromptEnhancementSettingsRoute,
});

function PromptEnhancementSettingsRoute() {
  return <PromptEnhancementSettingsPanel />;
}
