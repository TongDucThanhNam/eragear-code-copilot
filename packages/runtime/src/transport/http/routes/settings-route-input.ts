import type { SettingsPatch } from "#runtime/modules/settings";
import { parseUiSettingsForm } from "#runtime/shared/utils/ui-settings.util";
import type { Settings } from "../../../shared/types/settings.types";

export type SettingsRouteInputResult<T> =
  | { ok: true; input: T }
  | { ok: false; error: string };

export type UiSettingsFormData = Record<string, string | File | undefined>;

export interface ReadUiSettingsRouteInputParams {
  contentType: string | null | undefined;
  readJson: () => Promise<unknown>;
  readForm: () => Promise<UiSettingsFormData>;
  getCurrentSettings: () => Promise<Settings>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isJsonContentType(contentType: string | null | undefined): boolean {
  return (contentType ?? "").toLowerCase().includes("application/json");
}

export function parseJsonUiSettingsRouteInput(
  payload: unknown
): SettingsRouteInputResult<SettingsPatch> {
  if (!isRecord(payload)) {
    return { ok: false, error: "settings patch must be an object" };
  }

  return { ok: true, input: payload as SettingsPatch };
}

export function parseFormUiSettingsRouteInput(
  formData: UiSettingsFormData,
  currentSettings: Settings
): SettingsPatch {
  const { ui, projectRoots, app } = parseUiSettingsForm(
    formData,
    currentSettings
  );
  return { ui, projectRoots, app };
}

export async function readUiSettingsRouteInput({
  contentType,
  readJson,
  readForm,
  getCurrentSettings,
}: ReadUiSettingsRouteInputParams): Promise<
  SettingsRouteInputResult<SettingsPatch>
> {
  if (isJsonContentType(contentType)) {
    return parseJsonUiSettingsRouteInput(await readJson());
  }

  return {
    ok: true,
    input: parseFormUiSettingsRouteInput(
      await readForm(),
      await getCurrentSettings()
    ),
  };
}
