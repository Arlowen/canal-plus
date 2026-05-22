import { z } from "zod";

export const datasourceSchema = z.object({
  name: z.string().min(1),
  purpose: z.enum(["source", "target", "both"]),
  host: z.string().min(1),
  port: z.coerce.number().int().min(1).max(65535),
  username: z.string().min(1),
  password: z.string().min(1).optional(),
  defaultSchema: z.string().optional()
});

const fieldMappingSchema = z.object({
  sourceField: z.string().min(1),
  targetField: z.string().min(1),
  sourceType: z.string().min(1),
  targetType: z.string().min(1),
  primaryKey: z.boolean(),
  nullable: z.boolean(),
  ignored: z.boolean(),
  constantValue: z.string().optional()
});

const tableMappingSchema = z.object({
  id: z.string().optional(),
  sourceSchema: z.string().min(1),
  sourceTable: z.string().min(1),
  targetSchema: z.string().min(1),
  targetTable: z.string().min(1),
  fields: z.array(fieldMappingSchema).min(1)
});

export const taskSchema = z.object({
  name: z.string().min(1),
  description: z.string().default(""),
  owner: z.string().min(1),
  sourceDatasourceId: z.string().min(1),
  targetDatasourceId: z.string().min(1),
  tableMappings: z.array(tableMappingSchema).min(1),
  strategy: z.object({
    initMode: z.enum(["full_then_incremental", "incremental_only"]),
    writeMode: z.object({
      insert: z.boolean(),
      update: z.boolean(),
      delete: z.boolean()
    }),
    conflictStrategy: z.enum(["overwrite", "ignore", "fail"]),
    deleteStrategy: z.enum(["physical", "soft_delete", "ignore"]),
    batchSize: z.coerce.number().int().min(1).max(10000),
    retryTimes: z.coerce.number().int().min(0).max(20),
    retryIntervalSeconds: z.coerce.number().int().min(1).max(3600)
  })
});

export const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1)
});

export const skipErrorSchema = z.object({
  reason: z.string().min(2)
});
