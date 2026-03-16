import type { FeishuHeaders } from "./signature.js";
import { decodeFeishuPayload } from "./signature.js";

export type FeishuNormalized =
  | { kind: "challenge"; challenge: string }
  | { kind: "ignore"; reason: string }
  | {
      kind: "text";
      messageId: string;
      sessionKey: string;
      userId: string;
      chatId: string;
      text: string;
    }
  | {
      kind: "command";
      messageId: string;
      sessionKey: string;
      userId: string;
      chatId: string;
      command: string;
      args: string;
    };

function getHeaderTenantKey(body: any): string {
  return (
    body?.header?.tenant_key ??
    body?.header?.tenant_key_id ??
    body?.tenant_key ??
    "unknown"
  );
}

function getSenderUserId(body: any): string | undefined {
  return (
    body?.event?.sender?.sender_id?.user_id ??
    body?.event?.sender?.sender_id?.open_id ??
    body?.event?.sender?.sender_id?.union_id ??
    body?.event?.sender?.sender_id?.app_id
  );
}

export function normalizeFeishuWebhook(params: {
  rawBody: string;
  headers: FeishuHeaders;
  encryptKey?: string;
}): FeishuNormalized {
  const decoded = decodeFeishuPayload({
    rawBody: params.rawBody,
    headers: params.headers,
    encryptKey: params.encryptKey
  });

  const body = decoded.decrypted ?? decoded.payload;

  if (body?.type === "url_verification" && typeof body?.challenge === "string") {
    return { kind: "challenge", challenge: body.challenge };
  }

  const eventType = body?.header?.event_type;
  if (eventType !== "im.message.receive_v1") {
    return { kind: "ignore", reason: `unsupported event_type: ${eventType ?? ""}` };
  }

  const messageId = body?.event?.message?.message_id;
  const chatId = body?.event?.message?.chat_id;
  const msgType = body?.event?.message?.message_type;
  const contentRaw = body?.event?.message?.content;
  const userId = getSenderUserId(body);

  if (
    typeof messageId !== "string" ||
    typeof chatId !== "string" ||
    typeof userId !== "string"
  ) {
    return { kind: "ignore", reason: "missing messageId/chatId/userId" };
  }

  if (msgType !== "text" || typeof contentRaw !== "string") {
    return { kind: "ignore", reason: `unsupported msg_type: ${msgType ?? ""}` };
  }

  let text = "";
  try {
    const content = JSON.parse(contentRaw);
    text = typeof content?.text === "string" ? content.text : "";
  } catch {
    text = "";
  }

  if (!text) return { kind: "ignore", reason: "empty text" };

  const tenantKey = getHeaderTenantKey(body);
  const sessionKey = `${tenantKey}:${chatId}`;

  const trimmed = text.trim();
  if (trimmed.startsWith("/")) {
    const [cmd, ...rest] = trimmed.split(/\s+/);
    return {
      kind: "command",
      messageId,
      sessionKey,
      userId,
      chatId,
      command: cmd.toLowerCase(),
      args: rest.join(" ")
    };
  }

  return { kind: "text", messageId, sessionKey, userId, chatId, text };
}
