# Channel 管理 PRO 与实施计划

## 1. 背景

Canal Plus 当前已覆盖数据源、节点、告警和基础运维能力。下一阶段需要在数据源之上提供 `Channel` 管理页面，让用户以业务链路为单位组织迁移、同步、校验和订正任务。

一个 `Channel` 表示一条从源端到目标端的数据链路。每个 `Channel` 下可以包含多个 `Task`，每个 `Task` 执行一种明确的数据工作：

- `结构迁移`。
- `全量迁移`。
- `增量同步`。
- `结构对比`。
- `数据校验`。
- `数据订正`。

本 PRO 只定义产品范围、页面能力、核心模型和实施计划，不进行代码实现。

## 2. 参考项目

### 2.1 DataX

DataX 是阿里云 DataWorks 数据集成的开源版本，定位为离线数据同步工具。它将数据同步抽象为从源端读取数据的 Reader 插件，以及向目标端写入数据的 Writer 插件，并支持多种异构数据源同步。

参考点：

- 全量迁移按离线批任务设计。
- 源端读取和目标端写入分层。
- 任务配置需要描述源、目标、字段、并发、切分、错误控制。
- 运行结果需要有统计、日志、失败原因和可重试能力。

参考链接：https://github.com/alibaba/DataX

### 2.2 Canal

Canal 定位为基于 MySQL binlog 的增量订阅和消费组件。Canal 通过模拟 MySQL slave 协议向 MySQL master 发送 dump 请求，接收并解析 binary log，用于低延迟增量数据管道。

参考点：

- 增量同步是长运行任务，不是一次性任务。
- 需要保存 binlog 位点或 GTID checkpoint。
- 需要展示延迟、运行状态、消费速率和异常。
- 需要支持启动、停止、恢复和失败后续跑。

参考链接：https://github.com/alibaba/canal

## 3. 产品定位

Channel 管理页面定位为数据链路编排和运行观测页面，不是数据库客户端。

用户在一个 Channel 内完成：

- 选择源端和目标端数据源。
- 配置表级别映射。
- 配置列级别映射。
- 创建多个任务。
- 配置任务依赖。
- 执行预检查。
- 启动、停止、重跑任务。
- 查看日志、运行统计、校验差异和订正结果。

## 4. 核心目标

### 4.1 用户目标

- 管理员可以创建和维护数据链路。
- 运维人员可以启动、停止、重跑和观察任务。
- 只读用户可以查看 Channel、Task、日志和结果。
- 用户可以清楚看到一条链路上有哪些任务，以及每个任务的状态。
- 用户可以基于映射规则完成表名和列名转换。
- 用户可以从数据校验差异进入数据订正。

### 4.2 产品目标

- 用 Channel 聚合多个 Task，降低迁移链路管理成本。
- 将结构迁移、全量迁移、增量同步、结构对比、数据校验、数据订正纳入同一配置模型。
- 将映射配置沉淀为可复用版本。
- 为后续任务调度、节点分配、告警和审计提供统一元数据。

## 5. 名词定义

### 5.1 Channel

一条源端到目标端的数据链路。

示例：

```text
source_mysql_prod -> target_mysql_report
```

Channel 持有：

- 源端数据源。
- 目标端数据源。
- 表映射。
- 列映射。
- 任务列表。
- 运行状态。
- 最近一次运行结果。

### 5.2 Task

Channel 下的一个可执行工作单元。

Task 持有：

- 任务类型。
- 任务配置。
- 映射版本。
- 运行策略。
- 依赖关系。
- 最近运行状态。
- 运行日志和产物。

### 5.3 Mapping

用户定义的映射规则。

表级别映射：

```text
source_schema.source_table -> target_schema.target_table
```

列级别映射：

```text
source_column -> target_column
```

示例：

```text
源端表 A: a, b, c
目标表 B: A, B, C

表映射: A -> B
列映射: a -> A, b -> B, c -> C
```

### 5.4 Run

Task 的一次运行记录。

一次 Task 可以有多次 Run，例如全量迁移失败后重跑。

### 5.5 Checkpoint

可恢复运行位置。

- 全量迁移：批次、主键范围、游标或分页位置。
- 增量同步：binlog file/position 或 GTID。
- 数据校验：已完成主键范围。
- 数据订正：已处理差异记录位置。

### 5.6 Diff

数据校验生成的不一致结果。

Diff 必须包含：

- Channel ID。
- 校验 Task ID。
- Run ID。
- 表映射 ID。
- 主键值。
- 差异类型。
- 源端摘要。
- 目标端摘要。
- 差异列。
- 落盘时间。

## 6. 功能范围

### 6.1 包含

- Channel 列表。
- Channel 新增、编辑、删除、归档。
- Channel 详情。
- 源端和目标端数据源选择。
- 表级别映射配置。
- 列级别映射配置。
- 映射预检查。
- Task 新增、编辑、删除、复制。
- Task 排序和依赖配置。
- Task 启动、停止、重跑。
- Task 日志查看。
- Task 运行历史。
- Task 运行统计。
- 结构迁移任务配置和执行入口。
- 全量迁移任务配置和执行入口。
- 增量同步任务配置和执行入口。
- 结构对比任务配置和执行入口。
- 数据校验任务配置和执行入口。
- 数据订正任务配置和执行入口。
- 数据校验差异列表。
- 数据订正结果列表。
- 权限控制。
- 操作日志。

### 6.2 不包含

- 通用 SQL 编辑器。
- 任意 SQL 执行。
- 表数据在线编辑。
- 无主键表的数据校验。
- 无主键表的数据订正。
- 自动推断复杂表达式转换。
- 跨源端多表 join 转换。
- CDC 事件复杂路由。
- 目标端冲突的人工逐条合并界面。
- 非 MySQL 数据源的真实运行实现，除非后端已具备能力。

## 7. 用户角色

### 7.1 管理员

- 可以创建、编辑、删除、归档 Channel。
- 可以配置映射。
- 可以创建、编辑、删除 Task。
- 可以启动、停止、重跑 Task。
- 可以执行数据订正。

### 7.2 运维人员

- 可以查看 Channel。
- 可以查看和启动已配置 Task。
- 可以停止、重跑 Task。
- 可以查看日志、Diff 和运行统计。
- 默认不能修改映射。
- 默认不能删除 Channel 或 Task。

### 7.3 只读用户

- 可以查看 Channel、Task、日志、Diff 和运行统计。
- 不可以执行启动、停止、重跑、订正、保存、删除。

## 8. 页面入口

### 8.1 导航入口

左侧导航新增：

```text
Channel
```

### 8.2 默认页面

进入后展示 Channel 列表。

默认筛选：

- 状态：`全部`。
- 类型：`全部`。
- 源端：`全部`。
- 目标端：`全部`。
- 页码：第 1 页。
- 每页条数：`20 条/页`。

## 9. 页面结构

### 9.1 Channel 列表

页面采用后台管理表格布局。

顶部工具区：

- 关键字。
- 状态。
- 源端。
- 目标端。
- `查询`。
- `新增`。
- 刷新图标。

表格列：

- `Channel`。
- `源端`。
- `目标端`。
- `任务`。
- `状态`。
- `最近运行`。
- `创建时间`。
- `操作`。

行内操作：

- `详情`。
- `启动`。
- `停止`。
- `更多`。

更多菜单：

- `编辑`。
- `复制`。
- `归档`。
- `删除`。

### 9.2 Channel 详情

详情页采用顶部摘要 + Tabs。

摘要区展示：

- Channel 名称。
- 状态。
- 源端。
- 目标端。
- 任务数。
- 运行中任务数。
- 最近运行结果。
- 最近更新时间。

Tabs：

- `概览`。
- `映射`。
- `任务`。
- `运行`。
- `日志`。
- `差异`。
- `设置`。

### 9.3 概览 Tab

展示：

- Channel 基础信息。
- 源端和目标端连接状态。
- 任务状态分布。
- 最近 5 次运行记录。
- 最近 5 条错误日志。
- 待订正 Diff 数。
- 当前增量延迟。

### 9.4 映射 Tab

分为表映射和列映射。

表映射表格列：

- `源表`。
- `目标表`。
- `主键`。
- `状态`。
- `列数`。
- `操作`。

列映射表格列：

- `源列`。
- `源类型`。
- `目标列`。
- `目标类型`。
- `主键`。
- `可空`。
- `默认值`。
- `状态`。

操作：

- `扫描`：从源端读取表结构。
- `添加`：手动添加表映射。
- `导入`：批量导入映射。
- `导出`：导出当前映射。
- `预检`：检查映射是否完整、字段是否存在、主键是否满足任务要求。

### 9.5 任务 Tab

展示 Channel 下所有 Task。

表格列：

- `任务`。
- `类型`。
- `依赖`。
- `状态`。
- `进度`。
- `最近运行`。
- `耗时`。
- `操作`。

操作：

- `新增`。
- `启动`。
- `停止`。
- `重跑`。
- `日志`。
- `更多`。

更多菜单：

- `编辑`。
- `复制`。
- `删除`。

### 9.6 运行 Tab

展示 Task Run 历史。

表格列：

- `Run ID`。
- `任务`。
- `类型`。
- `状态`。
- `开始时间`。
- `结束时间`。
- `读`。
- `写`。
- `失败`。
- `耗时`。
- `操作`。

操作：

- `详情`。
- `日志`。
- `重跑`。

### 9.7 日志 Tab

支持按 Channel、Task、Run、级别和时间过滤。

日志格式必须符合项目规则：

```text
[time][level][thread]message
```

要求：

- level 只能是 `info`、`warn`、`error`。
- message 使用英文。
- 不输出密码、完整 DSN、Token、密钥。
- 长日志按时间倒序分页。

### 9.8 差异 Tab

展示数据校验生成的 Diff。

筛选：

- 校验任务。
- 运行批次。
- 表。
- 差异类型。
- 是否已订正。

表格列：

- `表`。
- `主键`。
- `类型`。
- `差异列`。
- `校验时间`。
- `订正状态`。
- `操作`。

操作：

- `详情`。
- `订正`。
- `忽略`。

### 9.9 设置 Tab

展示：

- Channel 名称。
- 描述。
- 标签。
- 默认运行节点。
- 并发上限。
- 错误阈值。
- 日志保留天数。
- Diff 保留天数。

## 10. Channel 状态

### 10.1 状态枚举

- `草稿`：配置未完成。
- `就绪`：配置完整，预检查通过。
- `运行中`：存在运行中的 Task。
- `告警`：存在失败、延迟超阈值或 Diff 未处理。
- `失败`：关键 Task 失败。
- `已停止`：用户停止运行。
- `已归档`：不再运行，只保留历史。

### 10.2 状态计算规则

- 只要有 Task 运行中，Channel 为 `运行中`。
- 增量同步运行但延迟超阈值，Channel 为 `告警`。
- 任一必需 Task 失败且未处理，Channel 为 `失败`。
- 所有一次性 Task 成功且无长运行任务，Channel 为 `就绪`。
- 用户主动停止后，Channel 为 `已停止`。
- 用户归档后，Channel 为 `已归档`。

## 11. Task 通用状态

### 11.1 配置状态

- `草稿`。
- `就绪`。
- `禁用`。

### 11.2 运行状态

- `排队中`。
- `运行中`。
- `停止中`。
- `已停止`。
- `成功`。
- `失败`。
- `已取消`。

### 11.3 长运行状态

增量同步是长运行任务，需要额外展示：

- `运行中`。
- `延迟`。
- `异常`。
- `已停止`。

## 12. Task 类型设计

### 12.1 结构迁移

目标：

根据用户定义的表级别和列级别映射，将源端表结构迁移到目标端。

输入：

- 源端数据源。
- 目标端数据源。
- 表映射。
- 列映射。
- 目标表存在策略。

目标表存在策略：

- `跳过`。
- `报错`。
- `补列`。
- `重建`。

首期建议只支持：

- `报错`。
- `补列`。

处理流程：

1. 读取源端表结构。
2. 应用表名映射。
3. 应用列名映射。
4. 生成目标端 DDL 计划。
5. 展示 DDL 预览。
6. 用户确认后执行。
7. 输出结构迁移日志。

规则：

- 必须先预检。
- 不自动删除目标端已有列。
- 不自动修改目标端已有列类型，首期只输出差异。
- DDL 执行失败后必须保留失败 SQL 和错误原因。
- 日志不展示敏感连接信息。

验收：

- 源表 `A(a,b,c)` 可以迁移为目标表 `B(A,B,C)`。
- 目标端缺表时可以创建。
- 目标端缺列时可以补列。
- 不一致字段会进入日志。

### 12.2 全量迁移

目标：

根据用户定义的表级别和列级别映射，将源端已有数据批量迁移到目标端。

输入：

- 表映射。
- 列映射。
- 读取批大小。
- 写入批大小。
- 并发数。
- 切分字段。
- 写入模式。
- 错误阈值。

写入模式：

- `insert`。
- `replace`。
- `upsert`。

首期建议默认：

- MySQL 到 MySQL 使用 `replace`。
- 非主键表只能使用 `insert` 或批量失败。

处理流程：

1. 执行映射预检。
2. 执行目标结构预检。
3. 按表生成迁移分片。
4. 从源端批量读取。
5. 应用列映射。
6. 写入目标端。
7. 记录统计和 checkpoint。
8. 失败后支持从 checkpoint 重跑。

规则：

- 默认不锁源表。
- 默认不清空目标表。
- 支持单表失败后继续或中止，由错误策略决定。
- 每个表必须统计读行数、写行数、失败行数。

验收：

- 可以按映射迁移表数据。
- 字段大小写映射生效。
- 失败行有日志。
- 重跑不会重复写出不可控脏数据。

### 12.3 增量同步

目标：

根据用户定义的表级别和列级别映射，将源端变化实时同步到目标端。

输入：

- 表映射。
- 列映射。
- 起始位点。
- 订阅过滤。
- 写入模式。
- 延迟阈值。

起始位点：

- 当前最新位点。
- 指定 binlog file/position。
- 指定 GTID。
- 从全量迁移捕获位点开始。

处理流程：

1. 检查源端 binlog 配置。
2. 校验表映射。
3. 建立增量订阅。
4. 接收变更事件。
5. 应用表和列映射。
6. 写入目标端。
7. 持续保存 checkpoint。
8. 展示延迟和吞吐。

规则：

- 增量同步是长运行任务。
- 必须支持停止和恢复。
- 必须保存 checkpoint。
- 必须展示延迟。
- DDL 事件首期只记录日志，不自动执行。
- 删除事件按任务配置决定是否同步。

验收：

- insert/update/delete 可以按映射写入目标端。
- 进程重启后可以从 checkpoint 继续。
- 位点异常、权限不足、binlog 不可用时有明确日志。

### 12.4 结构对比

目标：

根据用户定义的表级别映射，对比源端和目标端表结构是否一致。

输入：

- 表映射。
- 对比范围。

处理流程：

1. 读取源端表结构。
2. 读取目标端表结构。
3. 根据表映射配对。
4. 对比表是否存在。
5. 对比列是否存在。
6. 对比列类型、可空、默认值、主键。
7. 输出日志和结构差异。

规则：

- 只按表级别映射选择对比对象。
- 不要求列级别映射。
- 不修改目标端结构。
- 目标端缺表、缺列、不一致字段只输出日志。

验收：

- 目标端缺表时输出日志。
- 目标端缺列时输出日志。
- 列类型不一致时输出日志。
- 不执行 DDL。

### 12.5 数据校验

目标：

只支持有主键的表。根据用户定义的表级别和列级别映射，对源端和目标端进行逐行数据对比。如果不一致，根据主键落盘。

输入：

- 表映射。
- 列映射。
- 主键。
- 批大小。
- 差异保留策略。

处理流程：

1. 预检主键。
2. 按主键顺序读取源端数据。
3. 按映射后的主键查询目标端数据。
4. 对比映射后的列值。
5. 对不一致结果落盘。
6. 可选按目标端主键反向扫描，发现目标端存在但源端不存在的数据。
7. 输出校验统计。

差异类型：

- `目标缺失`。
- `源端缺失`。
- `字段不一致`。
- `读取失败`。
- `映射错误`。

规则：

- 无主键表不能创建数据校验任务。
- 主键必须被包含在列映射里。
- 大字段默认只记录摘要，不直接落盘完整值。
- 差异结果必须可被数据订正任务消费。

验收：

- 有主键表可以逐行校验。
- 无主键表预检失败。
- 不一致数据按主键落盘。
- Diff 可以在差异 Tab 查询。

### 12.6 数据订正

目标：

只支持有主键的表。根据用户定义的表级别和列级别映射，以及数据校验生成的不一致结果，查询源端数据，经过映射后 replace 到目标端。

输入：

- 数据校验 Task。
- 校验 Run。
- Diff 范围。
- 表映射。
- 列映射。
- 写入模式。

首期写入模式：

- `replace`。

处理流程：

1. 读取待订正 Diff。
2. 根据 Diff 中的主键查询源端。
3. 应用列映射。
4. replace 到目标端。
5. 更新 Diff 订正状态。
6. 输出订正统计。

规则：

- 必须绑定一个数据校验结果。
- 无主键表不能订正。
- 源端缺失时不执行 replace，只记录日志。
- 已订正 Diff 默认不重复处理。
- 支持 dry run。

验收：

- 可以基于 Diff 批量订正。
- 订正后 Diff 状态更新。
- 源端缺失数据不会写入空数据。
- 订正失败可重试。

## 13. 任务依赖

### 13.1 推荐链路

标准迁移链路：

```text
结构对比 -> 结构迁移 -> 全量迁移 -> 数据校验 -> 数据订正 -> 增量同步
```

低停机迁移链路：

```text
结构迁移 -> 捕获增量起始位点 -> 全量迁移 -> 从起始位点启动增量同步 -> 数据校验 -> 数据订正 -> 持续增量同步
```

只校验链路：

```text
结构对比 -> 数据校验 -> 数据订正
```

### 13.2 依赖规则

- 数据订正必须依赖数据校验。
- 数据校验必须依赖可用的主键和列映射。
- 全量迁移必须依赖结构存在。
- 增量同步必须依赖可用的起始位点。
- 结构对比不依赖列映射。
- 结构迁移依赖表映射和列映射。

## 14. 映射规则

### 14.1 表映射字段

- 映射 ID。
- 源库。
- 源表。
- 目标库。
- 目标表。
- 启用状态。
- 主键列表。
- 创建时间。
- 更新时间。

### 14.2 列映射字段

- 映射 ID。
- 表映射 ID。
- 源列。
- 源类型。
- 目标列。
- 目标类型。
- 是否主键。
- 是否可空。
- 默认值。
- 启用状态。

### 14.3 映射版本

每次保存映射后生成新版本。

规则：

- Task 运行时绑定映射版本。
- 历史 Run 保留当时使用的映射版本。
- 修改映射不会影响已完成 Run。
- 运行中的增量同步修改映射后需要重启或热加载，首期建议要求重启。

## 15. 数据模型草案

### 15.1 channels

- `id`。
- `name`。
- `description`。
- `source_datasource_id`。
- `target_datasource_id`。
- `status`。
- `owner`。
- `tags`。
- `mapping_version`。
- `task_count`。
- `last_run_id`。
- `last_run_status`。
- `created_at`。
- `updated_at`。
- `archived_at`。

### 15.2 channel_table_mappings

- `id`。
- `channel_id`。
- `mapping_version`。
- `source_schema`。
- `source_table`。
- `target_schema`。
- `target_table`。
- `primary_keys`。
- `enabled`。
- `created_at`。
- `updated_at`。

### 15.3 channel_column_mappings

- `id`。
- `channel_id`。
- `table_mapping_id`。
- `mapping_version`。
- `source_column`。
- `source_type`。
- `target_column`。
- `target_type`。
- `is_primary_key`。
- `nullable`。
- `default_value`。
- `enabled`。
- `created_at`。
- `updated_at`。

### 15.4 channel_tasks

- `id`。
- `channel_id`。
- `name`。
- `type`。
- `status`。
- `enabled`。
- `depends_on`。
- `mapping_version`。
- `config_json`。
- `last_run_id`。
- `last_run_status`。
- `created_at`。
- `updated_at`。

### 15.5 task_runs

- `id`。
- `channel_id`。
- `task_id`。
- `task_type`。
- `status`。
- `started_at`。
- `finished_at`。
- `read_rows`。
- `written_rows`。
- `failed_rows`。
- `diff_rows`。
- `error_message`。
- `created_by`。

### 15.6 task_logs

- `id`。
- `channel_id`。
- `task_id`。
- `run_id`。
- `level`。
- `thread`。
- `message`。
- `created_at`。

### 15.7 task_checkpoints

- `id`。
- `channel_id`。
- `task_id`。
- `run_id`。
- `checkpoint_type`。
- `checkpoint_json`。
- `updated_at`。

### 15.8 data_validation_diffs

- `id`。
- `channel_id`。
- `validation_task_id`。
- `validation_run_id`。
- `table_mapping_id`。
- `source_table`。
- `target_table`。
- `primary_key_json`。
- `diff_type`。
- `diff_columns_json`。
- `source_digest`。
- `target_digest`。
- `correction_status`。
- `correction_task_id`。
- `correction_run_id`。
- `created_at`。
- `updated_at`。

## 16. API 草案

### 16.1 Channel

```http
GET /api/channels
POST /api/channels
GET /api/channels/{channelId}
PUT /api/channels/{channelId}
DELETE /api/channels/{channelId}
POST /api/channels/{channelId}/archive
POST /api/channels/{channelId}/precheck
```

### 16.2 Mapping

```http
GET /api/channels/{channelId}/mappings
PUT /api/channels/{channelId}/mappings
POST /api/channels/{channelId}/mappings/scan
POST /api/channels/{channelId}/mappings/import
GET /api/channels/{channelId}/mappings/export
POST /api/channels/{channelId}/mappings/precheck
```

### 16.3 Task

```http
GET /api/channels/{channelId}/tasks
POST /api/channels/{channelId}/tasks
GET /api/channels/{channelId}/tasks/{taskId}
PUT /api/channels/{channelId}/tasks/{taskId}
DELETE /api/channels/{channelId}/tasks/{taskId}
POST /api/channels/{channelId}/tasks/{taskId}/start
POST /api/channels/{channelId}/tasks/{taskId}/stop
POST /api/channels/{channelId}/tasks/{taskId}/rerun
```

### 16.4 Run

```http
GET /api/channels/{channelId}/runs
GET /api/channels/{channelId}/tasks/{taskId}/runs
GET /api/channels/{channelId}/runs/{runId}
GET /api/channels/{channelId}/runs/{runId}/logs
```

### 16.5 Diff

```http
GET /api/channels/{channelId}/diffs
GET /api/channels/{channelId}/diffs/{diffId}
POST /api/channels/{channelId}/diffs/{diffId}/ignore
POST /api/channels/{channelId}/tasks/{taskId}/correct
```

## 17. 权限规则

### 17.1 管理员

- `channel:create`。
- `channel:update`。
- `channel:delete`。
- `mapping:update`。
- `task:create`。
- `task:update`。
- `task:delete`。
- `task:run`。
- `diff:correct`。

### 17.2 运维人员

- `channel:read`。
- `mapping:read`。
- `task:read`。
- `task:run`。
- `task:stop`。
- `run:read`。
- `log:read`。
- `diff:read`。

### 17.3 只读用户

- `channel:read`。
- `mapping:read`。
- `task:read`。
- `run:read`。
- `log:read`。
- `diff:read`。

## 18. 操作日志

以下操作必须写操作日志：

- 新增 Channel。
- 编辑 Channel。
- 删除 Channel。
- 归档 Channel。
- 保存映射。
- 导入映射。
- 新增 Task。
- 编辑 Task。
- 删除 Task。
- 启动 Task。
- 停止 Task。
- 重跑 Task。
- 执行数据订正。
- 忽略 Diff。

日志要求：

- 应用日志使用英文。
- 操作日志可以存结构化 detail。
- 不记录密码、完整 DSN、Token、密钥。

## 19. 前端实施计划

### 19.1 阶段一：静态产品页面和元数据 CRUD

目标：

- 完成 Channel 列表和详情框架。
- 完成 Channel 新增、编辑、删除、归档。
- 完成 Task 列表基础展示。
- 完成映射只读展示。

前端工作：

- 增加 Channel 导航。
- 增加 Channel 列表页。
- 增加 Channel 详情页。
- 增加新增/编辑抽屉。
- 增加状态标签。
- 增加权限控制。
- 增加 API 类型定义。

后端工作：

- 增加 Channel CRUD。
- 增加基础 Task CRUD。
- 增加操作日志。
- 增加分页和筛选。

验收：

- 可以创建 Channel。
- 可以进入详情。
- 可以添加 Task 草稿。
- 不涉及真实迁移执行。

### 19.2 阶段二：映射配置和预检查

目标：

- 完成表级别和列级别映射配置。
- 完成源端表结构扫描。
- 完成映射预检查。

前端工作：

- 增加映射 Tab。
- 增加表映射编辑。
- 增加列映射编辑。
- 增加批量导入和导出入口。
- 增加预检查结果展示。

后端工作：

- 增加 metadata scanner。
- 增加表结构读取接口。
- 增加映射保存和版本管理。
- 增加映射预检查。

验收：

- 可以配置 `A -> B`。
- 可以配置 `a -> A`、`b -> B`、`c -> C`。
- 无效映射会预检失败。
- 映射保存后生成版本。

### 19.3 阶段三：结构对比和结构迁移

目标：

- 先实现只读型结构对比。
- 再实现结构迁移 DDL 计划和执行。

前端工作：

- 增加结构对比 Task 配置。
- 增加结构迁移 Task 配置。
- 增加 DDL 预览。
- 增加结构差异日志展示。

后端工作：

- 增加结构对比 runner。
- 增加 DDL planner。
- 增加 DDL executor。
- 增加结构任务日志。

验收：

- 结构对比不修改目标端。
- 结构迁移可以创建缺失目标表。
- 结构迁移可以补缺失目标列。
- 不一致结构输出日志。

### 19.4 阶段四：全量迁移

目标：

- 实现 MySQL 到 MySQL 全量数据迁移。
- 支持批量读取、批量写入、统计、checkpoint 和重跑。

前端工作：

- 增加全量迁移配置表单。
- 增加运行进度。
- 增加运行统计。
- 增加失败日志入口。

后端工作：

- 增加 batch reader。
- 增加 target writer。
- 增加分片策略。
- 增加 checkpoint。
- 增加重跑能力。

验收：

- 可以迁移映射表数据。
- 可以看到读写统计。
- 失败可定位到表和批次。
- 重跑可复用 checkpoint。

### 19.5 阶段五：数据校验和数据订正

目标：

- 实现有主键表的逐行校验。
- 实现基于 Diff 的数据订正。

前端工作：

- 增加数据校验配置。
- 增加 Diff 列表。
- 增加 Diff 详情。
- 增加数据订正配置。
- 增加 dry run 结果展示。

后端工作：

- 增加 primary key validator。
- 增加 row comparator。
- 增加 Diff 落盘。
- 增加 correction runner。
- 增加 replace writer。

验收：

- 无主键表不能校验。
- 校验差异可以落盘。
- 数据订正可以消费 Diff。
- 订正后更新 Diff 状态。

### 19.6 阶段六：增量同步

目标：

- 实现基于 binlog 的长运行增量同步。
- 支持 checkpoint、延迟监控、停止和恢复。

前端工作：

- 增加增量同步配置。
- 增加长运行状态展示。
- 增加延迟指标。
- 增加 checkpoint 展示。
- 增加启动、停止、恢复操作。

后端工作：

- 增加 binlog reader。
- 增加 change event mapper。
- 增加 target writer。
- 增加 GTID/binlog checkpoint。
- 增加长运行 worker 和 lease。
- 增加延迟统计。

验收：

- insert/update/delete 可以同步。
- 任务重启后可以续跑。
- 延迟可见。
- binlog 权限或位点错误有日志。

### 19.7 阶段七：调度、告警和运维增强

目标：

- 将 Channel 和 Task 纳入节点调度、告警和容量管理。

前端工作：

- 增加节点分配展示。
- 增加任务资源占用。
- 增加告警入口。
- 增加任务批量操作。

后端工作：

- 增加 worker lease。
- 增加节点容量调度。
- 增加任务告警规则。
- 增加日志和 Diff 保留清理。

验收：

- Task 可以被分配到节点。
- 节点下线后任务状态可感知。
- 延迟和失败可触发告警。

## 20. 后端技术设计建议

### 20.1 模块划分

- `channel`：Channel 元数据。
- `mapping`：映射和版本。
- `metadata`：表结构扫描。
- `task`：Task 元数据。
- `runner`：任务执行框架。
- `checkpoint`：运行位点。
- `diff`：校验差异。
- `log`：任务日志。

### 20.2 Runner 接口

建议抽象：

```text
TaskRunner
  precheck(task)
  start(task, mappingVersion)
  stop(task)
  rerun(run)
  status(task)
```

不同任务类型实现不同 runner。

### 20.3 Connector 接口

建议抽象：

```text
MetadataReader
BatchReader
ChangeReader
DDLPlanner
DDLExecutor
TargetWriter
RowComparator
```

这样全量迁移、结构迁移、增量同步、校验和订正可以复用连接、映射和日志能力。

## 21. 风险和约束

### 21.1 主键约束

数据校验和数据订正只支持有主键表。无主键表必须在预检查阶段失败。

### 21.2 映射变更风险

运行中的 Task 使用固定映射版本。修改映射后必须要求用户重新预检。

### 21.3 全量和增量一致性

低停机迁移需要明确起始位点，否则全量迁移和增量同步之间可能丢数据或重复数据。

### 21.4 DDL 风险

结构迁移首期不做破坏性 DDL。删除列、修改列类型、重建表需要后续单独设计。

### 21.5 大表性能

全量迁移、数据校验和数据订正都需要批处理、checkpoint、限速和错误阈值。

### 21.6 日志敏感信息

日志不得输出密码、完整 DSN、Token、密钥。

## 22. 验收标准

- [ ] Channel 列表可展示、筛选、分页。
- [ ] Channel 详情包含概览、映射、任务、运行、日志、差异、设置。
- [ ] 一个 Channel 可以包含多个 Task。
- [ ] Task 类型包含结构迁移、全量迁移、增量同步、结构对比、数据校验、数据订正。
- [ ] 表级别映射支持源表到目标表。
- [ ] 列级别映射支持源列到目标列。
- [ ] 结构迁移可以按映射生成目标结构。
- [ ] 全量迁移可以按映射写入目标数据。
- [ ] 增量同步可以按映射实时写入目标数据。
- [ ] 结构对比只输出差异日志，不修改目标端。
- [ ] 数据校验只允许有主键表。
- [ ] 数据校验差异按主键落盘。
- [ ] 数据订正只允许有主键表。
- [ ] 数据订正可以消费数据校验 Diff。
- [ ] 数据订正按主键查询源端，映射后 replace 到目标端。
- [ ] Task 日志使用 `[time][level][thread]message`。
- [ ] 应用日志 message 使用英文。
- [ ] 权限控制符合管理员、运维人员、只读用户差异。
- [ ] 操作日志覆盖关键变更和运行操作。

## 23. 首期建议

首期不要一次性实现所有真实执行能力。建议第一版先交付：

1. Channel 元数据管理。
2. 映射配置。
3. Task 编排。
4. 结构对比。
5. 结构迁移。

原因：

- 结构能力风险低于数据写入。
- 映射模型可以先稳定下来。
- 全量迁移、增量同步、数据校验和数据订正都依赖稳定映射。
- 用户可以先通过结构对比和结构迁移验证链路配置是否正确。
