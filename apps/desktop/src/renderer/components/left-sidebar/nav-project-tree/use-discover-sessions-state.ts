"use client";

import { useState } from "react";
import type { DiscoverContext, DiscoverSessionItem } from "./types";

export function useDiscoverSessions() {
  const [discoverContext, setDiscoverContext] =
    useState<DiscoverContext | null>(null);
  const [discoverSessions, setDiscoverSessions] = useState<
    DiscoverSessionItem[]
  >([]);
  const [discoverNextCursor, setDiscoverNextCursor] = useState<string | null>(
    null
  );
  const [discoverSupported, setDiscoverSupported] = useState(false);
  const [discoverRequiresAuth, setDiscoverRequiresAuth] = useState(false);
  const [discoverLoadSessionSupported, setDiscoverLoadSessionSupported] =
    useState(false);
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [discoverIsLoading, setDiscoverIsLoading] = useState(false);
  const [discoverIsLoadingMore, setDiscoverIsLoadingMore] = useState(false);
  const [pendingLoadSessionId, setPendingLoadSessionId] = useState<
    string | null
  >(null);
  const [isDiscoverDialogOpen, setIsDiscoverDialogOpen] = useState(false);

  const resetDiscoverState = () => {
    setDiscoverContext(null);
    setDiscoverSessions([]);
    setDiscoverNextCursor(null);
    setDiscoverSupported(false);
    setDiscoverRequiresAuth(false);
    setDiscoverLoadSessionSupported(false);
    setDiscoverError(null);
    setDiscoverIsLoading(false);
    setDiscoverIsLoadingMore(false);
    setPendingLoadSessionId(null);
  };

  return {
    discoverContext,
    discoverSessions,
    discoverNextCursor,
    discoverSupported,
    discoverRequiresAuth,
    discoverLoadSessionSupported,
    discoverError,
    discoverIsLoading,
    discoverIsLoadingMore,
    pendingLoadSessionId,
    isDiscoverDialogOpen,
    setDiscoverContext,
    setDiscoverSessions,
    setDiscoverNextCursor,
    setDiscoverSupported,
    setDiscoverRequiresAuth,
    setDiscoverLoadSessionSupported,
    setDiscoverError,
    setDiscoverIsLoading,
    setDiscoverIsLoadingMore,
    setPendingLoadSessionId,
    setIsDiscoverDialogOpen,
    resetDiscoverState,
  };
}
