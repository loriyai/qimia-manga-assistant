import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
export const DELETE_WINDOW_MS = 12 * 60 * 60 * 1000;
export const ADMIN_SESSION_MS = 30 * 60 * 1000;

export function normalizeUserId(value) {
  const userId = String(value || "").normalize("NFC").trim();
  if (userId.length < 2 || userId.length > 40 || /[\u0000-\u001f\u007f]/.test(userId)) {
    const error = new Error("用户 ID 长度需为 2～40 个字符，且不能包含控制字符");
    error.status = 400;
    error.code = "INVALID_USER_ID";
    throw error;
  }
  return userId;
}

export function deletionDecision(item, currentUserId, overrideEnabled, now = Date.now()) {
  if (overrideEnabled) return { allowed: true, reason: "管理员删除权限已开启" };
  if (!currentUserId) return { allowed: false, reason: "请先在设置中填写本机用户 ID" };
  if (!item?.createdBy || !Number.isFinite(Date.parse(item?.createdAt))) {
    return { allowed: false, reason: "旧数据缺少创建者信息，仅管理员可以删除" };
  }
  if (item.createdBy !== currentUserId) return { allowed: false, reason: `由 ${item.createdBy} 创建，仅管理员可以删除` };
  const age = now - Date.parse(item.createdAt);
  if (age < 0 || age >= DELETE_WINDOW_MS) return { allowed: false, reason: "创建已满 12 小时，仅管理员可以删除" };
  return { allowed: true, reason: "可删除自己在 12 小时内创建的内容" };
}

export async function createPasswordRecord(usernameValue, password) {
  const username = normalizeAdminUsername(usernameValue);
  validatePassword(password);
  const salt = randomBytes(16).toString("hex");
  const hash = await derivePassword(password, salt);
  return { username, salt, passwordHash: hash.toString("hex"), algorithm: "scrypt-v1" };
}

export async function verifyPassword(record, usernameValue, password) {
  if (!record || record.username !== String(usernameValue || "").trim()) return false;
  try {
    const expected = Buffer.from(record.passwordHash, "hex");
    const actual = await derivePassword(password, record.salt);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function validatePassword(password) {
  if (typeof password !== "string" || password.length < 8 || password.length > 128) {
    const error = new Error("管理员密码长度需为 8～128 个字符");
    error.status = 400;
    error.code = "INVALID_PASSWORD";
    throw error;
  }
}

function normalizeAdminUsername(value) {
  const username = String(value || "").normalize("NFC").trim();
  if (username.length < 2 || username.length > 40) {
    const error = new Error("管理员账号长度需为 2～40 个字符");
    error.status = 400;
    error.code = "INVALID_ADMIN_USERNAME";
    throw error;
  }
  return username;
}

async function derivePassword(password, salt) {
  return scrypt(password, salt, 32, { N: 16384, r: 8, p: 1 });
}
