---
title: Custom endpoints (GLM, Qwen, Kimi, DeepSeek, MiniMax)
description: Chat with any Anthropic-compatible model provider — add its endpoint and API key in Settings, then pick its models in the composer.
---

Many model vendors serve the **Anthropic Messages API** directly: GLM on Z.AI,
Qwen on Alibaba Model Studio, Kimi on Moonshot, DeepSeek, MiniMax, and others.
Kanna can run them through the same Claude agent it uses for Claude itself, so
tools, skills, MCP servers, plan mode and subagents all work unchanged.

Only Anthropic-compatible endpoints work here. A vendor that offers only an
OpenAI-compatible API cannot be added.

## Add an endpoint

1. Open **Settings → Providers** and find **Custom endpoints**.
2. Click **Add endpoint** and pick a preset (GLM, Qwen, Kimi, DeepSeek,
   MiniMax), or **Custom…** for any other URL. A preset fills in the base URL
   and a few model ids; every field stays editable.
3. Paste your **API key** from the vendor's console.
4. Check the **models** list against the vendor's current model ids, then click
   **Add endpoint**.

The **id** (for example `glm`) becomes part of every model id, such as
`glm/glm-5.3`, so it cannot change after the endpoint is created.

### Preset endpoints

| Preset | Base URL | Notes |
| --- | --- | --- |
| GLM (Z.AI) | `https://api.z.ai/api/anthropic` | |
| Qwen (Alibaba Model Studio) | `https://coding-intl.dashscope.aliyuncs.com/apps/anthropic` | Coding Plan. Pay-as-you-go uses `https://{WorkspaceId}.<region>.maas.aliyuncs.com/apps/anthropic` |
| Kimi (Moonshot) | `https://api.moonshot.ai/anthropic` | |
| DeepSeek | `https://api.deepseek.com/anthropic` | |
| MiniMax | `https://api.minimax.io/anthropic` | Mainland China: `https://api.minimaxi.com/anthropic` |

Vendors rename models often. If a turn fails with an unknown-model error, check
the vendor's documentation and edit the model list.

## Chat with it

In the chat composer, open the provider menu and choose **Custom endpoints**.
The model picker lists every model of every endpoint you added, labelled with
the endpoint, for example **GLM (Z.AI) · glm-5.3**. The entry only appears once
at least one endpoint is configured.

Switching to a model on a different endpoint restarts the agent session on the
new endpoint; the conversation history is kept. Subagents can use custom
endpoints too: pick **Custom endpoints** as their provider in **Settings →
Subagents**.

## Your API key

The key is stored only in Kanna's settings file on the machine running Kanna,
and is sent only to the endpoint you configured. The browser never receives it:
Settings shows just its last four characters. To change it, edit the endpoint
and type a new key; leaving the field blank keeps the current one.

## Limits

- **No cost tracking.** Kanna has no prices for these models, so turns on a
  custom endpoint report tokens but no dollar cost.
- **No reasoning-effort or context-window controls.** The vendor decides how
  its model maps those; set them in the vendor's console if it offers them.
- **A stalled endpoint is failed after a timeout.** If the endpoint accepts the
  request but never streams a reply, Kanna stops the turn and names the endpoint
  in the error, the same protection OpenRouter turns get.
- **Deleting an endpoint** that an existing chat uses moves that chat to the
  first remaining custom model on its next message. If none remain, sending
  fails with an error asking you to pick another model.
