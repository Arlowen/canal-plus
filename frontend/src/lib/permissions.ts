import type { Role, User } from "../types/api";

export function canManageConfig(user: User | null) {
  return user?.role === "admin";
}

export function roleLabel(role?: Role) {
  if (role === "admin") return "管理员";
  return "运维操作员";
}
