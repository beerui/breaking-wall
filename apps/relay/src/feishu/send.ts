import { assertFeishuConfigured, config } from "../config.js";

type TenantTokenResp = {
  code: number;
  msg: string;
  tenant_access_token?: string;
  expire?: number;
};

let tokenCache: { token: string; expireAtMs: number } | undefined;

async function getTenantAccessToken(): Promise<string> {
  assertFeishuConfigured();
  const now = Date.now();
  if (tokenCache && tokenCache.expireAtMs - now > 60_000) return tokenCache.token;

  const resp = await fetch(
    "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        app_id: config.feishu.appId,
        app_secret: config.feishu.appSecret
      })
    }
  );
  const data = (await resp.json()) as TenantTokenResp;
  if (data.code !== 0 || !data.tenant_access_token || !data.expire) {
    throw new Error(`Failed to get tenant_access_token: ${data.code} ${data.msg}`);
  }

  tokenCache = {
    token: data.tenant_access_token,
    expireAtMs: now + data.expire * 1000
  };
  return tokenCache.token;
}

export async function replyText(messageId: string, text: string): Promise<void> {
  const token = await getTenantAccessToken();
  const resp = await fetch(
    `https://open.feishu.cn/open-apis/im/v1/messages/${encodeURIComponent(
      messageId
    )}/reply`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        msg_type: "text",
        content: JSON.stringify({ text })
      })
    }
  );

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`replyText failed: ${resp.status} ${resp.statusText} ${body}`);
  }

  const data = (await resp.json().catch(() => undefined)) as any;
  if (data && typeof data.code === "number" && data.code !== 0) {
    throw new Error(`replyText error: ${data.code} ${data.msg ?? ""}`);
  }
}

export async function replyMarkdown(messageId: string, content: string): Promise<void> {
  const token = await getTenantAccessToken();
  const card = {
    elements: [{ tag: "markdown", content }]
  };
  const resp = await fetch(
    `https://open.feishu.cn/open-apis/im/v1/messages/${encodeURIComponent(
      messageId
    )}/reply`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        msg_type: "interactive",
        content: JSON.stringify(card)
      })
    }
  );

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`replyMarkdown failed: ${resp.status} ${resp.statusText} ${body}`);
  }

  const data2 = (await resp.json().catch(() => undefined)) as any;
  if (data2 && typeof data2.code === "number" && data2.code !== 0) {
    throw new Error(`replyMarkdown error: ${data2.code} ${data2.msg ?? ""}`);
  }
}
