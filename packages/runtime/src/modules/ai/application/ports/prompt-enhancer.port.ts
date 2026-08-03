export interface PromptEnhancerInput {
  userId: string;
  chatId: string;
  text: string;
  source?:
    | "client"
    | "supervisor"
    | "automation"
    | "scheduled"
    | "orchestrator";
  projectRoot?: string;
  projectId?: string;
}

export interface PromptEnhancerResult {
  text: string;
  applied: boolean;
}

export interface PromptEnhancerPort {
  enhance(input: PromptEnhancerInput): Promise<PromptEnhancerResult>;
}
