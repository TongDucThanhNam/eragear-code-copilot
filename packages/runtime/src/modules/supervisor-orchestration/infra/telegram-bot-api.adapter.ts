import type {
  TelegramInboundUpdate,
  TelegramManagerApiPort,
} from "../application/telegram-manager-bridge.service";

interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

interface TelegramUpdatePayload {
  update_id: number;
  message?: { chat?: { id?: string | number }; text?: string };
  callback_query?: {
    id?: string;
    data?: string;
    message?: { chat?: { id?: string | number } };
  };
}

export class TelegramBotApiAdapter implements TelegramManagerApiPort {
  async getUpdates(input: {
    botToken: string;
    offset?: number;
    signal?: AbortSignal;
  }): Promise<TelegramInboundUpdate[]> {
    const result = await callTelegramApi<TelegramUpdatePayload[]>(
      input.botToken,
      "getUpdates",
      {
        timeout: 20,
        allowed_updates: ["message", "callback_query"],
        ...(input.offset !== undefined ? { offset: input.offset } : {}),
      },
      25_000,
      input.signal
    );
    return result.map(toInboundUpdate);
  }

  async sendMessage(input: {
    botToken: string;
    chatId: string;
    text: string;
    buttons?: Array<{ text: string; callbackData: string }>;
  }): Promise<void> {
    await callTelegramApi(input.botToken, "sendMessage", {
      chat_id: input.chatId,
      text: input.text.slice(0, 4000),
      ...(input.buttons && input.buttons.length > 0
        ? {
            reply_markup: {
              inline_keyboard: input.buttons.map((button) => [
                {
                  text: button.text,
                  callback_data: button.callbackData,
                },
              ]),
            },
          }
        : {}),
    });
  }

  async answerCallback(input: {
    botToken: string;
    callbackQueryId: string;
    text: string;
  }): Promise<void> {
    await callTelegramApi(input.botToken, "answerCallbackQuery", {
      callback_query_id: input.callbackQueryId,
      text: input.text.slice(0, 180),
    });
  }
}

async function callTelegramApi<T = unknown>(
  botToken: string,
  method: string,
  body: unknown,
  timeoutMs = 10_000,
  externalSignal?: AbortSignal
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const abortFromExternal = () => controller.abort();
  externalSignal?.addEventListener("abort", abortFromExternal, { once: true });
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${botToken}/${method}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      }
    );
    const parsed = (await response.json()) as TelegramApiResponse<T>;
    if (!(response.ok && parsed.ok)) {
      throw new Error(
        `Telegram ${method} failed: ${parsed.description ?? response.status}`
      );
    }
    return parsed.result as T;
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", abortFromExternal);
  }
}

function toInboundUpdate(update: TelegramUpdatePayload): TelegramInboundUpdate {
  const messageChatId = update.message?.chat?.id;
  const callbackChatId = update.callback_query?.message?.chat?.id;
  return {
    updateId: update.update_id,
    ...(messageChatId !== undefined
      ? {
          message: {
            chatId: String(messageChatId),
            ...(update.message?.text ? { text: update.message.text } : {}),
          },
        }
      : {}),
    ...(update.callback_query?.id &&
    update.callback_query.data &&
    callbackChatId !== undefined
      ? {
          callback: {
            id: update.callback_query.id,
            chatId: String(callbackChatId),
            data: update.callback_query.data,
          },
        }
      : {}),
  };
}
