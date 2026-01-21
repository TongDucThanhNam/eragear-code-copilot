"use client";

import { CheckIcon, ChevronDown, Command } from "lucide-react";
import { type RefObject, useCallback, useState } from "react";
import {
  ModelSelector,
  ModelSelectorContent,
  ModelSelectorEmpty,
  ModelSelectorGroup,
  ModelSelectorInput,
  ModelSelectorItem,
  ModelSelectorList,
  ModelSelectorLogo,
  ModelSelectorLogoGroup,
  ModelSelectorName,
  ModelSelectorTrigger,
} from "@/components/ai-elements/model-selector";
import {
  PromptInput,
  PromptInputActionAddAttachments,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuTrigger,
  PromptInputAttachment,
  PromptInputAttachments,
  PromptInputBody,
  PromptInputButton,
  PromptInputCommand,
  PromptInputCommandEmpty,
  PromptInputCommandInput,
  PromptInputCommandItem,
  PromptInputCommandList,
  PromptInputFooter,
  PromptInputHeader,
  PromptInputHoverCard,
  PromptInputHoverCardContent,
  PromptInputHoverCardTrigger,
  type PromptInputMessage,
  PromptInputProvider,
  PromptInputSelect,
  PromptInputSelectContent,
  PromptInputSelectItem,
  PromptInputSelectTrigger,
  PromptInputSelectValue,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  usePromptInputController,
} from "@/components/ai-elements/prompt-input";
import { Button } from "@/components/ui/button";
import type { SlashCommand } from "./slash-command-popup";

export type ChatInputStatus = "submitted" | "streaming" | "ready" | "error";
export type ConnStatus = "idle" | "connecting" | "connected" | "error";

export interface ChatInputProps {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  status: ChatInputStatus;
  connStatus: ConnStatus;
  availableModes: { id: string; name: string; description?: string }[];
  currentModeId: string | null;
  onModeChange: (modeId: string) => void;
  availableModels: { modelId: string; name: string; description?: string }[];
  currentModelId: string | null;
  onModelChange: (modelId: string) => void;
  onSubmit: (message: PromptInputMessage) => void;
  // Context Props
  activeTabs?: { path: string }[];
  projectRules?: { path: string; location: string }[];
  availableCommands?: SlashCommand[];
  onCancel?: () => void;
}

// Inner component for @ menu command items with controller access
function SlashCommandMenuItem({
  command,
  textareaRef,
}: {
  command: SlashCommand;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const controller = usePromptInputController();

  const handleSelect = useCallback(() => {
    const commandText = `/${command.name} `;
    controller.textInput.setInput(commandText);
    if (textareaRef.current) {
      textareaRef.current.focus();
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.selectionStart = commandText.length;
          textareaRef.current.selectionEnd = commandText.length;
        }
      }, 0);
    }
  }, [command.name, controller.textInput, textareaRef]);

  return (
    <PromptInputCommandItem onSelect={handleSelect}>
      <span>/{command.name}</span>
      <span className="ml-2 text-muted-foreground text-xs">
        - {command.description}
      </span>
    </PromptInputCommandItem>
  );
}

export function ChatInput({
  textareaRef,
  status,
  connStatus,
  availableModes,
  currentModeId,
  onModeChange,
  availableModels,
  currentModelId,
  onModelChange,
  onSubmit,
  activeTabs = [],
  projectRules = [],
  availableCommands = [],
  onCancel,
}: ChatInputProps) {
  const [modelSelectorOpen, setModelSelectorOpen] = useState(false);

  const getProviderFromModelId = (modelId: string) => {
    if (modelId.startsWith("anthropic")) {
      return "anthropic";
    }
    if (modelId.startsWith("google") || modelId.startsWith("gemini")) {
      return "google";
    }
    if (modelId.startsWith("openai") || modelId.startsWith("gpt")) {
      return "openai";
    }
    if (modelId.startsWith("deepseek")) {
      return "deepseek";
    }
    if (modelId.startsWith("mistral")) {
      return "mistral";
    }
    if (modelId.startsWith("meta") || modelId.startsWith("llama")) {
      return "meta";
    }
    return "opencode"; // default
  };

  const modelsWithDetails = availableModels.map((m) => {
    const providerSlug = getProviderFromModelId(m.modelId);
    return {
      ...m,
      id: m.modelId,
      chef: providerSlug.toUpperCase(),
      chefSlug: providerSlug,
      providers: [providerSlug],
    };
  });

  const chefs = Array.from(new Set(modelsWithDetails.map((m) => m.chef)));
  const selectedModelData = modelsWithDetails.find(
    (m) => m.id === currentModelId
  );

  return (
    <div className="w-full px-2 py-2">
      <PromptInputProvider>
        <PromptInput globalDrop multiple onSubmit={onSubmit}>
          <PromptInputHeader>
            <PromptInputHoverCard>
              <PromptInputHoverCardTrigger>
                <PromptInputButton
                  className="h-8!"
                  size="icon-sm"
                  variant="outline"
                >
                  <Command className="text-muted-foreground" size={12} />
                </PromptInputButton>
              </PromptInputHoverCardTrigger>
              <PromptInputHoverCardContent className="w-100 p-0">
                <PromptInputCommand>
                  <PromptInputCommandInput
                    className="border-none focus-visible:ring-0"
                    placeholder="Add files, folders, docs..."
                  />
                  <PromptInputCommandList>
                    <PromptInputCommandEmpty className="p-3 text-muted-foreground text-sm">
                      No results found.
                    </PromptInputCommandEmpty>
                    {availableCommands.map((cmd) => (
                      <SlashCommandMenuItem
                        command={cmd}
                        key={cmd.name}
                        textareaRef={textareaRef}
                      />
                    ))}
                  </PromptInputCommandList>
                </PromptInputCommand>
              </PromptInputHoverCardContent>
            </PromptInputHoverCard>

            <PromptInputAttachments>
              {(attachment) => <PromptInputAttachment data={attachment} />}
            </PromptInputAttachments>
          </PromptInputHeader>
          <PromptInputBody>
            <PromptInputTextarea ref={textareaRef} />
          </PromptInputBody>
          <PromptInputFooter>
            <PromptInputTools>
              <PromptInputActionMenu>
                <PromptInputActionMenuTrigger />
                <PromptInputActionMenuContent>
                  <PromptInputActionAddAttachments />
                </PromptInputActionMenuContent>
              </PromptInputActionMenu>

              {connStatus === "connected" && availableModes.length > 0 && (
                <PromptInputSelect
                  onValueChange={(val: string) => onModeChange(val)}
                  value={currentModeId || ""}
                >
                  <PromptInputSelectTrigger className="h-8 min-w-17.5 px-2 py-0">
                    <PromptInputSelectValue />
                  </PromptInputSelectTrigger>
                  <PromptInputSelectContent>
                    {availableModes.map((mode) => (
                      <PromptInputSelectItem key={mode.id} value={mode.id}>
                        {mode.name}
                      </PromptInputSelectItem>
                    ))}
                  </PromptInputSelectContent>
                </PromptInputSelect>
              )}

              {connStatus === "connected" && availableModels.length > 0 && (
                <ModelSelector
                  onOpenChange={setModelSelectorOpen}
                  open={modelSelectorOpen}
                >
                  <ModelSelectorTrigger asChild>
                    <Button
                      className="h-8 w-50 justify-between"
                      variant="outline"
                    >
                      {selectedModelData?.chefSlug && (
                        <ModelSelectorLogo
                          provider={selectedModelData.chefSlug}
                        />
                      )}
                      {selectedModelData?.name && (
                        <ModelSelectorName>
                          {selectedModelData.name}
                        </ModelSelectorName>
                      )}
                      <ChevronDown className="ml-auto h-4 w-4 opacity-50" />
                    </Button>
                  </ModelSelectorTrigger>
                  <ModelSelectorContent>
                    <ModelSelectorInput placeholder="Search models..." />
                    <ModelSelectorList>
                      <ModelSelectorEmpty>No models found.</ModelSelectorEmpty>
                      {chefs.map((chef) => (
                        <ModelSelectorGroup heading={chef} key={chef}>
                          {modelsWithDetails
                            .filter((model) => model.chef === chef)
                            .map((model) => (
                              <ModelSelectorItem
                                key={model.id}
                                onSelect={() => {
                                  onModelChange(model.id);
                                  setModelSelectorOpen(false);
                                }}
                                value={model.id}
                              >
                                <ModelSelectorLogo provider={model.chefSlug} />
                                <ModelSelectorName>
                                  {model.name}
                                </ModelSelectorName>
                                <ModelSelectorLogoGroup>
                                  {model.providers.map((provider) => (
                                    <ModelSelectorLogo
                                      key={provider}
                                      provider={provider}
                                    />
                                  ))}
                                </ModelSelectorLogoGroup>
                                {currentModelId === model.id ? (
                                  <CheckIcon className="ml-auto size-4" />
                                ) : (
                                  <div className="ml-auto size-4" />
                                )}
                              </ModelSelectorItem>
                            ))}
                        </ModelSelectorGroup>
                      ))}
                    </ModelSelectorList>
                  </ModelSelectorContent>
                </ModelSelector>
              )}
            </PromptInputTools>
            <PromptInputSubmit onStop={onCancel} status={status} />
          </PromptInputFooter>
        </PromptInput>
      </PromptInputProvider>
    </div>
  );
}
