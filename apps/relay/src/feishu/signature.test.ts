import { describe, expect, test } from "vitest";
import crypto from "node:crypto";
import {
  decryptFeishuEncrypt,
  sha256Hex,
  verifyFeishuSignature
} from "./signature.js";

describe("feishu signature", () => {
  test("verifyFeishuSignature matches sha256(ts+nonce+key+body)", () => {
    const encryptKey = "k";
    const rawBody = "{\"a\":1}";
    const headers = {
      "x-lark-request-timestamp": "1",
      "x-lark-request-nonce": "2",
      "x-lark-signature": sha256Hex("1" + "2" + encryptKey + rawBody)
    };

    expect(
      verifyFeishuSignature({ headers, encryptKey, rawBody })
    ).toBe(true);
  });

  test("decryptFeishuEncrypt decrypts iv+cipher base64", () => {
    const encryptKey = "encrypt_key";
    const plaintext = JSON.stringify({ hello: "world" });

    const key = crypto.createHash("sha256").update(encryptKey, "utf8").digest();
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
    cipher.setAutoPadding(true);
    const cipherText = Buffer.concat([
      cipher.update(Buffer.from(plaintext, "utf8")),
      cipher.final()
    ]);

    const encrypt = Buffer.concat([iv, cipherText]).toString("base64");
    expect(decryptFeishuEncrypt(encryptKey, encrypt)).toBe(plaintext);
  });
});
