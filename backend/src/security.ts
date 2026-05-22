import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Datasource, PublicDatasource } from "./types.js";

function secretKey() {
  const source = process.env.CANAL_PLUS_SECRET || "canal-plus-dev-secret-change-me";
  return createHash("sha256").update(source).digest();
}

export function hashPassword(password: string) {
  return createHash("sha256").update(`canal-plus:${password}`).digest("hex");
}

export function verifyPassword(password: string, expectedHash: string) {
  const actual = Buffer.from(hashPassword(password), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function encryptText(plainText: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secretKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["enc:v1", iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(":");
}

export function decryptText(secret: string) {
  if (!secret.startsWith("enc:v1:")) {
    return secret;
  }

  const [, , ivText, tagText, encryptedText] = secret.split(":");
  const decipher = createDecipheriv("aes-256-gcm", secretKey(), Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedText, "base64url")),
    decipher.final()
  ]).toString("utf8");
}

export function toPublicDatasource(datasource: Datasource): PublicDatasource {
  const { passwordSecret, ...rest } = datasource;
  return {
    ...rest,
    hasPassword: Boolean(passwordSecret)
  };
}
