"use client";

import {
  Component,
  type ErrorInfo,
  type ReactNode,
  useCallback,
  useEffect,
} from "react";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";

interface CrashBoundaryState {
  error: Error | null;
}

interface CrashBoundaryInnerProps {
  children: ReactNode;
  onCrash: (error: Error, componentStack?: string) => void;
}

class CrashBoundaryInner extends Component<
  CrashBoundaryInnerProps,
  CrashBoundaryState
> {
  state: CrashBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): CrashBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.props.onCrash(error, info.componentStack ?? undefined);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-dvh items-center justify-center bg-background p-6">
          <div className="grid max-w-md gap-4 rounded-md border bg-card p-5 text-card-foreground">
            <div>
              <h1 className="font-semibold text-lg">Something went wrong</h1>
              <p className="mt-1 text-muted-foreground text-sm">
                The crash was archived locally for review.
              </p>
            </div>
            <pre className="max-h-32 overflow-auto rounded bg-muted p-3 text-xs">
              {this.state.error.message}
            </pre>
            <Button onClick={() => window.location.reload()} type="button">
              Reload
            </Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export function CrashReportingErrorBoundary({
  children,
}: {
  children: ReactNode;
}) {
  const capture = trpc.crashReporting.capture.useMutation();
  const captureError = useCallback(
    (error: Error, componentStack?: string) => {
      capture.mutate({
        source: "web",
        level: "error",
        message: error.message || "Unhandled web error",
        stack: error.stack,
        ...(componentStack ? { componentStack } : {}),
        metadata: {
          location: window.location.href,
          userAgent: window.navigator.userAgent,
        },
      });
    },
    [capture]
  );

  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      const error =
        event.error instanceof Error
          ? event.error
          : new Error(event.message || "Unhandled window error");
      captureError(error);
    };
    const handleRejection = (event: PromiseRejectionEvent) => {
      const error =
        event.reason instanceof Error
          ? event.reason
          : new Error(String(event.reason ?? "Unhandled promise rejection"));
      captureError(error);
    };
    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleRejection);
    return () => {
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleRejection);
    };
  }, [captureError]);

  return (
    <CrashBoundaryInner onCrash={captureError}>{children}</CrashBoundaryInner>
  );
}
