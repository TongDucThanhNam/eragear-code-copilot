import { useEffect, useMemo, useState } from "react";

type UiSettings = {
  theme: "light" | "dark" | "system";
  accentColor: string;
  density: "comfortable" | "compact";
  fontScale: number;
};

type SettingsResponse = {
  ui: UiSettings;
  projectRoots: string[];
};

const fallbackSettings: SettingsResponse = {
  ui: {
    theme: "system",
    accentColor: "#2563eb",
    density: "comfortable",
    fontScale: 1,
  },
  projectRoots: [],
};

export default function App() {
  const [settings, setSettings] =
    useState<SettingsResponse>(fallbackSettings);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [newRoot, setNewRoot] = useState("");

  const accentStyle = useMemo(
    () => ({ color: settings.ui.accentColor }),
    [settings.ui.accentColor]
  );

  useEffect(() => {
    let isMounted = true;
    fetch("/api/ui-settings")
      .then((res) => res.json())
      .then((data: SettingsResponse) => {
        if (isMounted && data?.ui) {
          setSettings(data);
        }
      })
      .catch(() => {
        if (isMounted) {
          setStatus("Không thể tải cài đặt từ server.");
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsLoading(false);
        }
      });
    return () => {
      isMounted = false;
    };
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    setStatus(null);
    try {
      const res = await fetch("/api/ui-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (!res.ok) {
        throw new Error("Save failed");
      }
      setStatus("Đã lưu cài đặt.");
    } catch (err) {
      setStatus("Lưu thất bại, vui lòng thử lại.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 px-6 py-12 text-slate-100">
      <div className="mx-auto w-full max-w-3xl space-y-8">
        <header className="space-y-2">
          <p className="text-sm uppercase tracking-[0.3em] text-slate-400">
            EraGear Server
          </p>
          <h1 className="text-3xl font-semibold">
            Cấu hình giao diện cho server
          </h1>
          <p className="text-sm text-slate-400">
            Điều chỉnh theme, màu nhấn, mật độ hiển thị và các project root
            được phép truy cập.
          </p>
        </header>

        <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 shadow-lg shadow-slate-950/50">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-medium">Giao diện hiển thị</h2>
              <p className="text-sm text-slate-400">
                Các thay đổi sẽ áp dụng khi reload trang UI.
              </p>
            </div>
            <span
              className="rounded-full border border-slate-800 bg-slate-950 px-3 py-1 text-xs font-medium"
              style={accentStyle}
            >
              Accent preview
            </span>
          </div>

          <div className="mt-6 grid gap-6 md:grid-cols-2">
            <label className="space-y-2 text-sm">
              <span className="text-slate-300">Theme mặc định</span>
              <select
                className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-500"
                value={settings.ui.theme}
                onChange={(event) =>
                  setSettings((prev) => ({
                    ...prev,
                    ui: {
                      ...prev.ui,
                      theme: event.target.value as UiSettings["theme"],
                    },
                  }))
                }
                disabled={isLoading}
              >
                <option value="system">System</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </label>

            <label className="space-y-2 text-sm">
              <span className="text-slate-300">Màu nhấn</span>
              <div className="flex items-center gap-3">
                <input
                  className="h-10 w-14 rounded border border-slate-800 bg-slate-950"
                  type="color"
                  value={settings.ui.accentColor}
                  onChange={(event) =>
                    setSettings((prev) => ({
                      ...prev,
                      ui: { ...prev.ui, accentColor: event.target.value },
                    }))
                  }
                  disabled={isLoading}
                />
                <input
                  className="flex-1 rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-500"
                  value={settings.ui.accentColor}
                  onChange={(event) =>
                    setSettings((prev) => ({
                      ...prev,
                      ui: { ...prev.ui, accentColor: event.target.value },
                    }))
                  }
                  disabled={isLoading}
                />
              </div>
            </label>

            <label className="space-y-2 text-sm">
              <span className="text-slate-300">Mật độ hiển thị</span>
              <div className="flex gap-3">
                {(["comfortable", "compact"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() =>
                      setSettings((prev) => ({
                        ...prev,
                        ui: { ...prev.ui, density: mode },
                      }))
                    }
                    disabled={isLoading}
                    className={`flex-1 rounded-lg border px-3 py-2 text-sm transition ${
                      settings.ui.density === mode
                        ? "border-slate-500 bg-slate-800"
                        : "border-slate-800 bg-slate-950 hover:border-slate-600"
                    }`}
                  >
                    {mode === "comfortable" ? "Thoải mái" : "Gọn"}
                  </button>
                ))}
              </div>
            </label>

            <label className="space-y-2 text-sm">
              <span className="text-slate-300">
                Tỷ lệ chữ ({settings.ui.fontScale.toFixed(2)}x)
              </span>
              <input
                className="w-full accent-slate-400"
                type="range"
                min={0.85}
                max={1.2}
                step={0.01}
                value={settings.ui.fontScale}
                onChange={(event) =>
                  setSettings((prev) => ({
                    ...prev,
                    ui: { ...prev.ui, fontScale: Number(event.target.value) },
                  }))
                }
                disabled={isLoading}
              />
            </label>
          </div>

          <div className="mt-6 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
            <button
              type="button"
              onClick={handleSave}
              disabled={isLoading || isSaving}
              className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-900 transition hover:bg-white disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-300"
            >
              {isSaving ? "Đang lưu..." : "Lưu cài đặt"}
            </button>
            {status && <p className="text-sm text-slate-400">{status}</p>}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 shadow-lg shadow-slate-950/50">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-medium">Project roots được phép</h2>
              <p className="text-sm text-slate-400">
                Các session chỉ được mở trong các đường dẫn này. Dùng Docker
                thì hãy mount các path cần thiết trước.
              </p>
            </div>
            <span className="rounded-full border border-slate-800 bg-slate-950 px-3 py-1 text-xs font-medium text-slate-300">
              {settings.projectRoots.length || "Không giới hạn"}
            </span>
          </div>

          <div className="mt-4 space-y-3">
            <div className="flex flex-col gap-3 sm:flex-row">
              <input
                className="flex-1 rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-500"
                placeholder="/workspace/my-project"
                value={newRoot}
                onChange={(event) => setNewRoot(event.target.value)}
              />
              <button
                type="button"
                className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-100 transition hover:border-slate-500"
                onClick={() => {
                  const trimmed = newRoot.trim();
                  if (!trimmed) {
                    return;
                  }
                  setSettings((prev) => ({
                    ...prev,
                    projectRoots: Array.from(
                      new Set([...prev.projectRoots, trimmed])
                    ),
                  }));
                  setNewRoot("");
                }}
                disabled={isLoading}
              >
                Thêm path
              </button>
            </div>

            <div className="space-y-2">
              {settings.projectRoots.length === 0 ? (
                <p className="text-sm text-slate-500">
                  Hiện tại không giới hạn. Thêm ít nhất 1 path để giới hạn.
                </p>
              ) : (
                settings.projectRoots.map((root) => (
                  <div
                    key={root}
                    className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
                  >
                    <span className="truncate">{root}</span>
                    <button
                      type="button"
                      onClick={() =>
                        setSettings((prev) => ({
                          ...prev,
                          projectRoots: prev.projectRoots.filter(
                            (item) => item !== root
                          ),
                        }))
                      }
                      className="text-xs text-slate-400 hover:text-slate-200"
                    >
                      Xóa
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 text-sm text-slate-400">
          <p>
            Dữ liệu lưu tại <code className="text-slate-200">.eragear/ui-settings.json</code>{" "}
            trên máy chủ.
          </p>
        </section>
      </div>
    </div>
  );
}
