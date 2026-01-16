import { useToast } from "heroui-native";
import { useEffect, useRef } from "react";
import { useChatStore } from "@/store/chat-store";

/**
 * Hook that watches the chat store for errors and displays them as toast notifications.
 * Uses HeroUI Native Toast with 'danger' variant for error display.
 *
 * Place this hook in a component that is always mounted (e.g., root layout)
 * to ensure errors are captured and displayed globally.
 */
export function useErrorToast() {
	const { toast } = useToast();
	const error = useChatStore((s) => s.error);
	const setError = useChatStore((s) => s.setError);

	// Track the last shown error to prevent duplicate toasts
	const lastShownError = useRef<string | null>(null);

	useEffect(() => {
		if (error && error !== lastShownError.current) {
			lastShownError.current = error;

			toast.show({
				id: `error-${Date.now()}`,
				variant: "danger",
				label: "Error",
				description: error,
				placement: "top",
				actionLabel: "Dismiss",
				onActionPress: ({ hide }) => {
					hide();
					setError(null);
				},
				onHide: () => {
					// Clear the error from store when toast is hidden
					setError(null);
					lastShownError.current = null;
				},
			});
		}
	}, [error, toast, setError]);

	return { error };
}
