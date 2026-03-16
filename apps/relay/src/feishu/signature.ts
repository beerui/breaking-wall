import crypto from "node:crypto";

export type FeishuHeaders = {
  "x-lark-request-timestamp"?: string;
  "x-lark-request-nonce"?: string;
  "x-lark-signature"?: string;
};

export function sha256Hex(data: string): string {
  return crypto.createHash("sha256").update(data, "utf8").digest("hex");
}

export function verifyFeishuSignature(params: {
  headers: FeishuHeaders;
  encryptKey: string;
  rawBody: string;
}): boolean {
  const ts = params.headers["x-lark-request-timestamp"];
  const nonce = params.headers["x-lark-request-nonce"];
  const signature = params.headers["x-lark-signature"];
  if (!ts || !nonce || !signature) return false;

  const expected = sha256Hex(ts + nonce + params.encryptKey + params.rawBody);
  return expected.toLowerCase() === signature.toLowerCase();
}

function aesKeyFromEncryptKey(encryptKey: string): Buffer {
  return crypto.createHash("sha256").update(encryptKey, "utf8").digest();
}

export function decryptFeishuEncrypt(encryptKey: string, encrypt: string): string {
  const buf = Buffer.from(encrypt, "base64");
  if (buf.length < 17) throw new Error("Invalid encrypt payload");

  const iv = buf.subarray(0, 16);
  const cipherText = buf.subarray(16);
  const key = aesKeyFromEncryptKey(encryptKey);

  const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
  decipher.setAutoPadding(true);
  const plain = Buffer.concat([decipher.update(cipherText), decipher.final()]);
  return plain.toString("utf8");
}

export function parseFeishuJson(rawBody: string): unknown {
  try {
    return JSON.parse(rawBody);
  } catch {
    return undefined;
  }
}

export function decodeFeishuPayload(params: {
  rawBody: string;
  headers: FeishuHeaders;
  encryptKey?: string;
}): { payload: any; decrypted?: any } {
  const payload = parseFeishuJson(params.rawBody);
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid JSON body");
  }

  const encrypt = (payload as any).encrypt;
  if (typeof encrypt === "string") {
    if (!params.encryptKey) {
      throw new Error("encrypt payload received but FEISHU_ENCRYPT_KEY not configured");
    }
    if (!verifyFeishuSignature({
      headers: params.headers,
      encryptKey: params.encryptKey,
      rawBody: params.rawBody
    })) {
      throw new Error("Invalid x-lark-signature");
    }

    const decryptedRaw = decryptFeishuEncrypt(params.encryptKey, encrypt);
    const decrypted = parseFeishuJson(decryptedRaw);
    if (!decrypted || typeof decrypted !== "object") {
      throw new Error("Invalid decrypted JSON");
    }
    return { payload, decrypted };
  }

  return { payload };
}
