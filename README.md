# dsh-model-fix

修复特定模型在 DeepSeek Harness（DSH）里「流式内容正常但回合必报错」的**流式收尾缺陷**。

## 背景：muse-spark-1.2 直连问题的根因

opencode 聚合端点（`https://opencode.ai/zen/go/v1`）上的 **muse-spark-1.2** 实现有缺陷：
流式响应正常吐出内容，但**从不发送 `finish_reason`、也不发送 `[DONE]`**，流直接关闭
（同端点对照 `deepseek-v4-flash` / `glm-5.2` 均正常发送 `finish_reason: 'stop'` + `[DONE]`）。

DSH 的 `llm-pi-ai` 走 pi-ai SDK（强制 `stream: true` 且要求流以 `finish_reason` 收尾），
于是每次对话的真实表现是：

1. 内容正常流式显示；
2. 结尾报 `Stream ended without finish_reason`（映射为 `TRANSPORT` 错误）；
3. 回合被判失败，且 `TRANSPORT` 在默认可重试列表里 → agent 级重试插件按
   `maxRetries`（opencode-go3 配置了 10 次）反复重跑整步，**烧多份 token**。

这与代理无关：直连与走代理的响应完全相同，换代理解决不了。

## ⚠️ 重要说明：无需开启 opencode 的「Allow models that train on request data」

使用 muse-spark-1.2（经 opencode-go 路由）**不需要**在 opencode 平台设置里开启
**「Allow models that train on request data」**。

- 该开关是 opencode 的**数据训练授权**：开启后你的请求数据可能被用于模型训练，属于
  需要慎重对待的隐私授权，**不要为了使用 muse-spark 而开启它**；
- 实测：不开启该开关，直连 `https://opencode.ai/zen/go/v1` 的 muse-spark-1.2 即可正常
  返回内容（本插件修复的只是流式收尾缺陷，与训练授权无关）；
- 若在 opencode 设置里看到该开关，保持**关闭**即可；本文档所述修复不依赖它。

开关位置见下图（opencode 设置页 → 提供商区域，与「启用部署在中国的模型」相邻）：

![opencode 设置页中的「Allow models that train on request data」开关（opencode 设置页 → 提供商区域）](https://raw.githubusercontent.com/bitterSmilezzz/dsh-model-fix/main/assets/opencode-settings-train-toggle.png)

## 本插件做什么

在 `llm/stream` waterfall 上，对匹配的模型把上述缺陷收尾为正常 `stop`：

- **仅当流已输出内容**（`text-delta` / `reasoning-delta` / `tool-call-delta`）且
  结尾错误代码为 `TRANSPORT` / `STREAM_CLOSED` **且错误信息明确是「缺少终止事件」**
  （如 `Stream ended without finish_reason`）时才改写；
- 真实传输故障（如 `SocketError: other side closed`）**不受影响，照常失败**；
- 无内容的空响应也照常失败，不会被误吞。

修复后 muse-spark-1.2 直连即可正常使用，无需代理、不触发重试。

## 安装

```sh
# 本地路径
dsh plugin --profile web add /path/to/dsh-model-fix

# 或发布后从 GitHub / npm
# dsh plugin --profile web add github:bitterSmilezzz/dsh-model-fix
# dsh plugin --profile web add dsh-model-fix
```

安装后**重启目标 profile**（如 `dsh web`）生效。

## 配置

`cordis.patch.yml` 中 `config` 两个字段：

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `modelPattern` | `^muse-spark` | 对模型 id 测试的正则；只修复匹配的模型 |
| `providers` | `[]` | provider 路由键白名单（如 `opencode-go3`）；空 = 所有 provider 中匹配的模型 |

```yaml
- id: model-fix
  name: dsh-model-fix
  config:
    modelPattern: '^muse-spark'
    providers: []
```

## 开发

```sh
pnpm install
pnpm verify    # typecheck + build + node --test
```

## 验证矩阵

- 单元测试：`tests/fix.test.mjs` 覆盖缺陷识别、内容保留、空响应放行、真实故障放行等 10 例。
- 真实端点集成验证：用 pi-ai 同款 SDK 直连 muse-spark-1.2，内容经本插件转换后
  结尾由 `error(Stream ended without finish_reason)` 变为 `{"kind":"stop"}`。
