import type { Settings } from "../types/settings.types";

type FormDataRecord = Record<string, string | File | undefined>;

export function parseUiSettingsForm(
  formData: FormDataRecord,
  currentSettings: Settings
) {
  const getString = (key: string): string => {
    const value = formData[key];
    return typeof value === "string" ? value : "";
  };

  const ui = {
    theme: (getString("ui.theme") || currentSettings.ui.theme) as
      | "light"
      | "dark"
      | "system",
    accentColor: getString("ui.accentColor") || currentSettings.ui.accentColor,
    density: (getString("ui.density") || currentSettings.ui.density) as
      | "comfortable"
      | "compact",
    fontScale:
      Number.parseFloat(getString("ui.fontScale")) ||
      currentSettings.ui.fontScale,
  };

  const projectRoots: string[] = [];
  let hasExplicitRoots = false;
  const newRoot = getString("newRoot").trim();
  const removeRoot = getString("removeRoot").trim();

  for (const key of Object.keys(formData)) {
    if (key.startsWith("projectRoots[")) {
      const value = formData[key];
      if (typeof value === "string") {
        projectRoots.push(value);
        hasExplicitRoots = true;
      }
    }
  }

  if (!hasExplicitRoots) {
    projectRoots.push(...currentSettings.projectRoots);
  }

  if (newRoot && !removeRoot && !projectRoots.includes(newRoot)) {
    projectRoots.push(newRoot);
  }

  if (removeRoot) {
    const filtered = projectRoots.filter((root) => root !== removeRoot);
    projectRoots.length = 0;
    projectRoots.push(...filtered);
  }

  return { ui, projectRoots };
}
