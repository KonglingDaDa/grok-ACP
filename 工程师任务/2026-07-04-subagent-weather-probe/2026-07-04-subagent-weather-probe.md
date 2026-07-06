# 任务：ACP 模式下调用子 Agent 搜索北京市明天天气

## 背景

PM 需要验证：通过 grokACP（`grok agent stdio` ACP 通道）派发的 Grok Composer 2.5 Fast，**能否成功调用子 Agent（Task 工具）** 完成一次真实的信息检索。

这是一次**纯探测任务**，不修改任何仓库文件，不写代码，不 git commit。

## 只允许修改这些文件

无。本任务**禁止**修改、创建、删除任何文件（回执由 grokACP 自动生成，不算你主动改文件）。

## 执行要求

### 步骤一：调用子 Agent

你必须使用 **Task 工具**（子 Agent）完成搜索，**不得**自己直接用 WebSearch / 浏览器工具代替子 Agent。

派发子 Agent 时：

- `subagent_type`: `generalPurpose`
- `description`: 简短标题，例如「北京明日天气」
- `prompt`: 明确写清「搜索北京市明天（次日）的天气预报，返回气温、降水、风力等要点，注明信息来源或查询时间」

### 步骤二：根据子 Agent 结果写结论

子 Agent 返回后，你在最终回复里必须包含以下结构（缺一不可）：

```markdown
# 回执：subagent-weather-probe

**结论：** PASS | PARTIAL | BLOCKED

**子 Agent 调用：** 成功 | 失败

**失败原因（若失败）：** <具体错误信息，无则写「无」>

---

## 子 Agent 汇报摘要

<子 Agent 返回的天气信息摘要，2-5 句>

## 技术观察

1. Task 工具是否在 ACP stdio 下可用：<是/否>
2. 若不可用，你看到的错误/限制：<原文或 paraphrase>
```

### 边界

- 不要修改代码、不要跑 lint、不要派 Critic（本任务非代码任务）。
- 若 Task 工具不可用或调用失败，**不要**改用 WebSearch 凑答案；直接回报 **BLOCKED** 或 **PARTIAL**，并写明失败原因。
- 若子 Agent 调用成功但天气信息查不到，结论可为 **PARTIAL**，但须证明子 Agent 确实被调用过。

## 验收

无代码验收。以你是否**真实调用 Task 子 Agent** 并在回复中按格式汇报为准。

## 回复格式

严格按上文「步骤二」的 Markdown 结构输出最终回复全文。