export const EXTERNAL_AI_CONSULTATION_PROVIDERS = [
  "chatgpt",
  "gemini",
] as const;

export type ExternalAiConsultationProvider =
  (typeof EXTERNAL_AI_CONSULTATION_PROVIDERS)[number];

const EXTERNAL_AI_CONSULTATION_URLS: Record<
  ExternalAiConsultationProvider,
  string
> = {
  chatgpt: "https://chatgpt.com/",
  gemini: "https://gemini.google.com/app",
};

interface ExternalAiConsultationSenderEvent {
  readonly sender: object;
}

interface ExternalAiConsultationHandlerDeps {
  getMainWindow(): object | null;
  getWindowFromSender(event: ExternalAiConsultationSenderEvent): object | null;
  openExternal(url: string): Promise<void>;
}

export function isExternalAiConsultationProvider(
  value: unknown
): value is ExternalAiConsultationProvider {
  return value === "chatgpt" || value === "gemini";
}

export function externalAiConsultationUrl(
  provider: ExternalAiConsultationProvider
): string {
  return EXTERNAL_AI_CONSULTATION_URLS[provider];
}

/**
 * Creates the privileged IPC handler without exposing an arbitrary URL seam.
 * The renderer supplies only a provider enum; prompt text remains in the
 * renderer's explicit copy/paste flow and is never encoded into the URL.
 */
export function createExternalAiConsultationHandler(
  deps: ExternalAiConsultationHandlerDeps
): (
  event: ExternalAiConsultationSenderEvent,
  provider: unknown
) => Promise<void> {
  return async (event, provider) => {
    const mainWindow = deps.getMainWindow();
    if (!mainWindow || deps.getWindowFromSender(event) !== mainWindow) {
      throw new Error(
        "External AI consultation requests must originate from the main renderer."
      );
    }
    if (!isExternalAiConsultationProvider(provider)) {
      throw new Error("Unsupported external AI consultation provider.");
    }
    await deps.openExternal(externalAiConsultationUrl(provider));
  };
}
