import type { Href } from "expo-router";

export function buildChatRoute(chatId: string, isActive?: boolean): Href {
  if (isActive === true) {
    return `/chats/${chatId}` as Href;
  }
  return `/chats/${chatId}?readonly=true` as Href;
}

export function resolveChatReadOnly(params: {
  forceActive: boolean;
  isReadOnlyParam: boolean;
  sessionIsActive?: boolean;
}): boolean {
  if (params.forceActive) {
    return false;
  }
  if (params.sessionIsActive === true) {
    return false;
  }
  if (params.sessionIsActive === false) {
    return true;
  }
  return params.isReadOnlyParam;
}

export function canResumeInactiveSession(params: {
  sessionIsActive?: boolean;
  loadSessionSupported?: boolean;
}): boolean {
  return (
    params.sessionIsActive !== true && params.loadSessionSupported === true
  );
}
