import { isAuthConfigured } from "@/lib/auth-config";
import { useAuthStore } from "@/store/auth-store";

export function useAuthConfigured(): boolean {
  const serverUrl = useAuthStore((s) => s.serverUrl);
  return isAuthConfigured({ serverUrl });
}
