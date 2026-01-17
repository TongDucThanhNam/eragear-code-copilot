import { useErrorToast } from "@/hooks/use-error-toast";

/**
 * A component that watches for errors in the chat store and displays them as toasts.
 * Must be placed inside HeroUINativeProvider.
 *
 * This is a "headless" component that doesn't render any UI itself,
 * it only manages the toast notifications for errors.
 */
export function ErrorToastHandler() {
  useErrorToast();
  return null;
}
