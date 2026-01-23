export interface UiSettings {
  theme: "light" | "dark" | "system";
  accentColor: string;
  density: "comfortable" | "compact";
  fontScale: number;
}

export interface Settings {
  ui: UiSettings;
  projectRoots: string[];
}
