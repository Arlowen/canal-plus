import type { Role, User } from "../types/api";

export function canManageConfig(user: User | null) {
  return user?.role === "admin";
}

export function canTestDatasource(user: User | null) {
  return user?.role === "admin" || user?.role === "operator";
}

export function roleLabel(role?: Role) {
  if (role === "admin") return "管理员";
  if (role === "readonly") return "只读用户";
  return "运维操作员";
}
