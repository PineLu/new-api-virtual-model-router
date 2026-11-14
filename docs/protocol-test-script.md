# New API 多协议端到端测试脚本

脚本：[`scripts/test_protocols.py`](../scripts/test_protocols.py)。只使用 Python 3.9+ 标准库，**不需要 SDK、依赖安装或 New API Fork**。

## 准备

- New API 正常运行，例如 `http://localhost:3003`。
- Virtual Model Router v0.3.0 已激活。待测渠道（例如 #14）包含 `deepseek-flash`，且有对应的虚拟模型路由表。
- 使用一个**临时、低额度、仅允许被测模型**的 New API API Key；分组（例如 `svip`）由这个 Key 决定。**勿使用之前已在聊天中泄露的 Key。**

推荐在终端安全输入（不把 Key 写入 shell 命令历史）：

```bash
printf 'NEW_API_KEY: '
read -rs NEW_API_KEY
export NEW_API_KEY
echo

python3 scripts/test_protocols.py \
  --base-url http://localhost:3003 \
  --model deepseek-flash \
  --checks json stream \
  --timeout 45 \
  --delay 1 \
  --json-report /tmp/vmr-protocol-result.json
```

上面先测试三个协议的非流式 JSON 和 SSE，共 **6 项**。如需测试真实工具调用：

```bash
python3 scripts/test_protocols.py --model deepseek-flash --checks tools

# 所有测试结束后清除当前终端的环境变量
unset NEW_API_KEY
```

脚本默认执行全部 **9 项**：3 个协议 × （JSON、SSE、工具调用）；也可以用 `--protocols anthropic` 单独测 Claude。

## 校验内容

| 客户端协议 | 普通响应 | SSE | 工具调用 |
|---|---|---|---|
| OpenAI Chat `/v1/chat/completions` | `chat.completion` + `choices[0].message` | Chat chunks + `[DONE]` | `tool_calls[].function.name=vmr_probe` |
| Anthropic Messages `/v1/messages` | `type=message` + `content[]` | `message_start` / `message_stop` | `content[].type=tool_use` |
| OpenAI Responses `/v1/responses` | `object=response` + `output[]` | `response.created` / `response.completed` | `output[].type=function_call` |

输出每项 `PASS/FAIL`、HTTP 状态、耗时、响应中真实模型名（如上游提供）、请求 ID（如网关提供）、简短失败原因。

- 退出码 `0`：全部通过；`1`：任意项目失败；`2`：缺少必要参数 / API Key。
- **HTTP 200 不代表完全成功**：脚本还会校验客户端协议响应结构、SSE 终止事件，以及工具调用结构。
- 合法响应中若正文为空会显示提示（部分推理模型会返回 reasoning-only 的完成消息），不会凭空判定模型输出质量通过。
- 工具调用测试使用强制 `tool_choice`。免费模型可能不支持强制调用，这种情况会明确报错，代表模型/转换器链路不兼容，不一定是插件的路由算法错误。
- 请求会走真实提供商；限流、过期、欠费、渠道不匹配和 503 都会原样报告。建议使用免费模型并设置低额度测试 Key。
- JSON 报告**不包含 API Key**；也不记录完整请求正文和上游完整响应，但仍可能包含模型名、请求 ID 和错误信息，请合理保存。

## 常见错误

- `503 No available channel for model deepseek-flash under group svip`：首先检查 New API 的渠道发现、用户分组、渠道模型授权和渠道缓存；这发生在插件路由前，不可直接认定为协议适配错误。
- `404/405`：检查插件版本是否启用、当前 New API 是否注册了相应的 `meta.relay` 协议入口。
- `200` 但返回 Chat JSON 而非 Anthropic / Responses JSON：协议转换没有按预期生效，脚本会判为失败。
- JSON 通过但 SSE 失败：检查 RelayKit 的流式事件转换和上游 SSE。
- 工具调用失败：检查所选免费模型是否支持工具、RelayKit 对 `tool_choice` 的转换；该项与文本成功应分别记录。
- 请求响应中显示真实模型名不等于已证明路由命中哪个 New API 渠道；跨渠道选择请结合 New API 使用日志验证。

## 测试脚本自身（无需 Key、不调用付费服务）

```bash
python3 -m unittest discover -s test -p 'test_protocol_script.py' -v
```

使用仅监听 `127.0.0.1` 的临时 Mock 服务，校验 9 种测试用例以及错误脱敏、503 处理和 SSE 解析。
