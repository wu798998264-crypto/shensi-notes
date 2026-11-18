import { createServer } from "node:http";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { gunzipSync, inflateSync, zstdDecompressSync } from "node:zlib";
import { fetchProvider } from "./network-proxy.mjs";
import { normalizeAgentPermissionMode } from "../agent-permission-policy.js";

const contentText = (content) => typeof content === "string" ? content : (Array.isArray(content) ? content : []).map((part) => part.text || "").join("\n");
const safeDetail = (value, apiKey = "") => String(value || "").replaceAll(apiKey || "\0", "[REDACTED]").replace(/Bearer\s+[^\s"',;]+/giu, "Bearer [REDACTED]").replace(/\b(?:sk|ds|api)[-_][A-Za-z0-9_-]{12,}\b/giu, "[REDACTED]");
export const providerRetryTime = (value, now = Date.now()) => {
  const raw = String(value || "").trim();
  const until = /^\d+$/u.test(raw) ? now + Number(raw) * 1000 : /[A-Za-z]{3},/u.test(raw) ? Date.parse(raw) : NaN;
  if (!Number.isFinite(until) || Math.abs(until) > 8.64e15) return {};
  return { retryAfterSeconds: Math.max(0, Math.ceil((until - now) / 1000)), retryAt: new Date(until).toISOString() };
};

export const textProviderFailure = ({ status = 502, payload, retryAfter = "", apiKey = "", observedHttpStatus = 0, includeProviderMetadata = false }) => {
  let detail = payload?.error || payload || {};
  if (typeof detail === "string") detail = { message: detail };
  for (let i = 0; i < 3 && typeof detail?.message === "string"; i++) {
    try { const nested = JSON.parse(detail.message); if (!nested?.error) break; detail = typeof nested.error === "string" ? { message: nested.error } : nested.error; } catch { break; }
  }
  const contextLimit = /context[_ -]?(?:length|window)|too[_ -]?many[_ -]?(?:input[_ -]?)?tokens|prompt[_ -]?too[_ -]?long/iu.test(String(detail.code || "") + " " + String(detail.type || ""));
  const missingModel = status === 404 && (/^model[_ -]not[_ -]found$/iu.test(String(detail.code || "")) || /(?:requested )?model\b[^\n]{0,200}\b(?:does not exist|not found)\b/iu.test(String(detail.message || "")));
  const noCompatibleAccount = status === 503 && /\bno compatible account is available for this model\b/iu.test(String(detail.message || ""));
  const reason = missingModel ? "上游明确返回所选模型不存在，请刷新该配置的模型目录并手动选择可用模型；未自动换模型或重复提交"
    : noCompatibleAccount ? "服务商当前没有可处理该型号的账号"
    : contextLimit ? "完整资料超过当前模型的上下文限制，请缩小引用范围；未截断正文，也未更换模型"
    : status === 429 ? "上游限流，请稍后重试"
    : status === 401 ? "上游拒绝认证，请核对当前连接"
    : status === 403 ? "上游拒绝权限，请核对账号与模型权限"
    : String(detail.param || "") === "input" ? "上游拒绝了文字输入或工具续接参数" : "上游服务返回错误";
  const scalar = value => ["string", "number"].includes(typeof value) ? String(value) : "";
  let publicMetadata = {};
  if (includeProviderMetadata) {
    // Gateways may wrap the actual provider failure in metadata.raw. Extract
    // message/code only, never copy arbitrary request bodies or headers.
    const metadata = detail.metadata && typeof detail.metadata === "object" ? detail.metadata : {};
    let raw = metadata.raw;
    if (typeof raw === "string") {
      raw = raw.slice(0, 16000);
      try { raw = JSON.parse(raw); } catch { raw = /^[<{[]/u.test(raw.trim()) ? null : { message: raw }; }
    }
    const inner = raw && typeof raw === "object" ? raw.error || raw : {};
    const messages = [...new Set([scalar(detail.message), scalar(inner.message)].filter(Boolean))];
    publicMetadata = { providerName: scalar(metadata.provider_name).slice(0, 100),
      providerType: scalar(metadata.error_type || detail.type).slice(0, 100),
      limitSource: scalar(metadata.limit_source).slice(0, 100),
      providerCode: scalar(metadata.provider_code || inner.code || detail.code || detail.type).slice(0, 100),
      providerDetail: messages.join("；").replaceAll(apiKey || "\0", "[REDACTED]").replace(/Bearer\s+\S+/giu, "Bearer [REDACTED]").slice(0, 1200) };
  }
  const wait = providerRetryTime(retryAfter), waitText = wait.retryAt ? `；建议等待 ${wait.retryAfterSeconds} 秒后重试` : "";
  const providerDetail = safeDetail(publicMetadata.providerDetail || detail.message, apiKey).slice(0, 600);
  return {
    code: missingModel ? "TEXT_PROVIDER_MODEL_UNAVAILABLE" : "TEXT_PROVIDER_REJECTED", statusCode: status,
    providerHttpStatus: Number(observedHttpStatus) || 0,
    message: includeProviderMetadata && status === 429 && publicMetadata.limitSource === "upstream_provider_account"
      ? `文字生成失败：HTTP 429，${publicMetadata.providerName || "上游厂商"}账户级请求受限；不是神思账号未登录，也不能据此认定你的额度耗尽${waitText || "；厂商未提供恢复时间"}。${providerDetail ? ` 上游原因：${providerDetail}` : ""}`
      : `文字生成失败：HTTP ${status}，${reason}${waitText}。${providerDetail ? ` 上游原因：${providerDetail}` : ""}`,
    providerCode: String(detail.code || detail.type || "").slice(0, 100),
    providerParam: String(detail.param || "").slice(0, 80),
    ...publicMetadata,
    providerDetail,
    retryAfter: wait.retryAt ? String(retryAfter).slice(0, 100) : "",
    ...wait,
  };
};
export const responsesInputToChat = (input = [], instructions = "", names = new Map()) => {
  const messages = instructions ? [{ role: "system", content: instructions }] : [];
  let nativeImages=[];
  const flushImages=()=>{if(nativeImages.length){messages.push({role:'user',content:nativeImages});nativeImages=[];}};
  for (const item of typeof input === "string" ? [{ role: "user", content: input }] : input) {
    if(!['function_call_output','custom_tool_call_output'].includes(item.type))flushImages();
    if (item.type === "function_call" || item.type === "custom_tool_call") {
      const name = item.namespace ? `${item.namespace}_${item.name}` : item.name;
      const args = item.type === "custom_tool_call"
        ? JSON.stringify({ input: String(item.input || "") })
        : item.arguments;
      const call = { id: item.call_id, type: "function", function: { name, arguments: args } };
      if (messages.at(-1)?.role === "assistant" && messages.at(-1).tool_calls) messages.at(-1).tool_calls.push(call);
      else messages.push({ role: "assistant", content: null, tool_calls: [call] });
    } else if (item.type === "function_call_output" || item.type === "custom_tool_call_output") {
      const parts=nativeToolParts(item.output);
      if(parts){messages.push({role:'tool',tool_call_id:item.call_id,content:parts.filter(p=>!p.image).map(p=>p.text).join('\n')});nativeImages.push(...parts.filter(p=>p.image).map(p=>({type:'image_url',image_url:{url:p.image,detail:'auto'}})));}
      else messages.push({ role: "tool", tool_call_id: item.call_id, content: typeof item.output === "string" ? item.output : JSON.stringify(item.output) });
    }
    else if (item.role) {
      const images = Array.isArray(item.content) && item.content.some((part) => part.type === "input_image");
      const content = images ? item.content.map((part) => part.type === "input_image" ? { type: "image_url", image_url: { url: part.image_url, detail: part.detail || "auto" } } : { type: "text", text: part.text || "" }) : contentText(item.content);
      if (content && item.role === "assistant" && messages.at(-1)?.tool_calls) {
        // Responses may emit a commentary message after a function call.
        // Chat requires tool outputs directly after their assistant call;
        // keep commentary on that same message rather than splitting it.
        const previous = messages.at(-1);
        previous.content = [contentText(previous.content), contentText(content)].filter(Boolean).join("\n");
      } else if (content) messages.push({ role: item.role === "developer" ? "system" : item.role, content });
    }
  }
  flushImages();return messages;
};

function nativeToolParts(output){let value=output;try{if(typeof value==='string')value=JSON.parse(value);}catch{return null;}const parts=Array.isArray(value)?value:value?.contentItems||value?.content;if(!Array.isArray(parts)||!parts.some(p=>['input_image','inputImage'].includes(p?.type)))return null;return parts.map(p=>['input_image','inputImage'].includes(p.type)?{image:p.image_url||p.imageUrl}:{text:p.text||''});}

const parsedObject = (value, fallback = {}) => {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
};

const anthropicImageBlock = (part = {}) => {
  const imageUrl = String(part.image_url?.url || part.image_url || "").trim();
  if (!imageUrl) return null;
  const dataUrl = /^data:([^;,]+);base64,(.+)$/su.exec(imageUrl);
  return {
    type: "image",
    source: dataUrl
      ? { type: "base64", media_type: dataUrl[1], data: dataUrl[2] }
      : { type: "url", url: imageUrl },
  };
};

const appendAnthropicMessage = (messages, role, content = []) => {
  const blocks = (Array.isArray(content) ? content : []).filter(Boolean);
  if (!blocks.length) return;
  const normalizedRole = role === "assistant" ? "assistant" : "user";
  if (messages.at(-1)?.role === normalizedRole) messages.at(-1).content.push(...blocks);
  else messages.push({ role: normalizedRole, content: blocks });
};

export const responsesInputToAnthropic = (input = [], instructions = "") => {
  const messages = [];
  const system = [];
  if (String(instructions || "").trim()) system.push(String(instructions).trim());
  for (const item of typeof input === "string" ? [{ role: "user", content: input }] : input) {
    if (!item || typeof item !== "object") continue;
    if (item.type === "function_call" || item.type === "custom_tool_call") {
      const name = item.namespace ? `${item.namespace}_${item.name}` : item.name;
      appendAnthropicMessage(messages, "assistant", [{
        type: "tool_use",
        id: item.call_id || item.id || `call_${randomUUID()}`,
        name: String(name || ""),
        input: item.type === "custom_tool_call"
          ? { input: String(item.input || "") }
          : parsedObject(item.arguments),
      }]);
      continue;
    }
    if (item.type === "function_call_output" || item.type === "custom_tool_call_output") {
      const native=nativeToolParts(item.output);
      appendAnthropicMessage(messages, "user", [{
        type: "tool_result",
        tool_use_id: item.call_id || item.id,
        content: native?native.map(p=>p.image?anthropicImageBlock({image_url:p.image}):{type:'text',text:p.text}):typeof item.output === "string" ? item.output : JSON.stringify(item.output),
      }]);
      continue;
    }
    if (!item.role) continue;
    const rawParts = typeof item.content === "string" ? [{ type: "text", text: item.content }] : Array.isArray(item.content) ? item.content : [];
    const blocks = rawParts.map((part) => {
      if (!part || typeof part !== "object") return null;
      if (["text", "input_text", "output_text"].includes(part.type) && String(part.text || "").trim()) return { type: "text", text: String(part.text) };
      if (part.type === "input_image") return anthropicImageBlock(part);
      return null;
    }).filter(Boolean);
    if (["system", "developer"].includes(item.role)) {
      const value = blocks.filter((part) => part.type === "text").map((part) => part.text).join("\n").trim();
      if (value) system.push(value);
    } else appendAnthropicMessage(messages, item.role, blocks);
  }
  return { system: system.join("\n\n"), messages };
};

const providerToolsFor = (requestedTools = [], shensiTools = []) => {
  const shensiByName = new Map(shensiTools.map((tool) => [String(tool?.name || ""), tool]));
  const includedShensi = new Set();
  const merged = [];
  for (const tool of Array.isArray(requestedTools) ? requestedTools : []) {
    const name = String(tool?.name || "");
    if (tool?.type === "namespace" && name) {
      for (const child of Array.isArray(tool.tools) ? tool.tools : []) {
        const childName = String(child?.name || "");
        if (childName) includedShensi.add(`${name}_${childName}`);
      }
    }
    if (name && shensiByName.has(name)) {
      if (!includedShensi.has(name)) merged.push(shensiByName.get(name));
      includedShensi.add(name);
      continue;
    }
    merged.push(tool);
  }
  for (const [name, tool] of shensiByName) {
    if (!includedShensi.has(name)) merged.push(tool);
  }
  return merged;
};

const chatToolProjection = (tools = []) => {
  const projected = [];
  const calls = new Map();
  const add = ({ name, description = "", parameters = null, target }) => {
    const normalizedName = String(name || "").replace(/[^A-Za-z0-9_-]/gu, "_").slice(0, 64);
    if (!normalizedName || calls.has(normalizedName)) return;
    calls.set(normalizedName, target);
    projected.push({
      type: "function",
      function: {
        name: normalizedName,
        description: String(description || "Agent tool").slice(0, 1_024),
        parameters: parameters && typeof parameters === "object"
          ? parameters
          : { type: "object", properties: {}, additionalProperties: true },
      },
    });
  };
  for (const tool of Array.isArray(tools) ? tools : []) {
    const type = String(tool?.type || "");
    const name = String(tool?.name || "");
    if (type === "function" && name) {
      add({
        name,
        description: tool.description,
        parameters: tool.parameters || tool.input_schema,
        target: { type: "function", name },
      });
      continue;
    }
    if (type === "namespace" && name) {
      for (const child of Array.isArray(tool.tools) ? tool.tools : []) {
        const childName = String(child?.name || "");
        if (!childName) continue;
        add({
          name: `${name}_${childName}`,
          description: child.description || tool.description,
          parameters: child.parameters || child.input_schema || child.inputSchema,
          target: { type: "namespace", namespace: name, name: childName },
        });
      }
      continue;
    }
    if (type === "custom" && name) {
      add({
        name,
        description: `${String(tool.description || name)} Return the custom tool input in the input string field.`,
        parameters: {
          type: "object",
          properties: { input: { type: "string", description: "Exact custom tool input" } },
          required: ["input"],
          additionalProperties: false,
        },
        target: { type: "custom", name },
      });
    }
  }
  return { tools: projected, calls };
};

const anthropicToolProjection = (tools = []) => {
  const projected = chatToolProjection(tools);
  const webSearch = (Array.isArray(tools) ? tools : []).some((tool) => ["web_search", "web_search_preview"].includes(String(tool?.type || "")));
  return {
    calls: projected.calls,
    tools: [
      ...(webSearch ? [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }] : []),
      ...projected.tools.map((tool) => ({
        name: tool.function.name,
        description: tool.function.description,
        input_schema: tool.function.parameters,
      })),
    ],
  };
};

const chatCallAsResponsesItem = (call, projection = new Map()) => {
  const callId = call?.id || `call_${randomUUID()}`;
  const functionName = String(call?.function?.name || "");
  const target = projection.get(functionName) || { type: "function", name: functionName };
  const args = String(call?.function?.arguments || "{}");
  if (target.type === "custom") {
    let input = args;
    try {
      const parsed = JSON.parse(args);
      if (typeof parsed?.input === "string") input = parsed.input;
    } catch {}
    return { type: "custom_tool_call", id: `ctc_${randomUUID()}`, call_id: callId, name: target.name, input, status: "completed" };
  }
  return {
    type: "function_call",
    id: `fc_${randomUUID()}`,
    call_id: callId,
    ...(target.type === "namespace" ? { namespace: target.namespace } : {}),
    name: target.name,
    arguments: args,
    status: "completed",
  };
};

export const startCodexProviderBridge = async ({ settings, tools, permissionContract = null, fetchImpl = globalThis.fetch, signal, onRequest = () => {}, singleProviderAttempt = false, nativeWebSearchEnabled = false }) => {
  const token = randomBytes(32).toString("hex");
  // The lightweight general lane intentionally has no workspace tool host.
  // Keep the provider bridge usable for text-only API profiles instead of
  // dereferencing a null runtime before the first model request.
  const dynamicTools = Array.isArray(tools?.dynamicTools) ? tools.dynamicTools : [];
  const catalog = new Map(dynamicTools.flatMap((ns) => (Array.isArray(ns?.tools) ? ns.tools : []).map((tool) => [`${ns.name}_${tool.name}`, { namespace: ns.name, name: tool.name, tool }])));
  const functionTools = [...catalog].map(([name, { tool }]) => ({ type: "function", name, description: tool.description, parameters: tool.inputSchema, strict: false }));
  const forwardNativeTools = normalizeAgentPermissionMode(permissionContract?.mode || settings.agentPermissionMode) !== "shensi_only";
  const known = new Map();
  let lastFailure = null;
  const controllers = new Set();
  const server = createServer(async (req, res) => {
    const auth = String(req.headers.authorization || ""), expected = `Bearer ${token}`;
    if (auth.length !== expected.length || !timingSafeEqual(Buffer.from(auth), Buffer.from(expected))) { res.writeHead(403); res.end(); return; }
    const controller = new AbortController(); controllers.add(controller);
    let phase = "input", requestDiagnostics = null, upstreamStatus = 0;
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    res.on("close", () => { if (!res.writableEnded) controller.abort(); });
    lastFailure = null;
    try {
      if (req.method !== "POST" || !/\/responses$/u.test(req.url || "")) throw new Error("当前提供商桥仅提供 Responses 任务推理");
      const chunks = []; let bytes = 0;
      for await (const chunk of req) { bytes += chunk.length; if (bytes > 32_000_000) throw new Error("推理输入超过大小上限"); chunks.push(chunk); }
      let buffer = Buffer.concat(chunks);
      if (req.headers["content-encoding"] === "gzip") buffer = gunzipSync(buffer);
      else if (req.headers["content-encoding"] === "deflate") buffer = inflateSync(buffer);
      else if (req.headers["content-encoding"] === "zstd") buffer = zstdDecompressSync(buffer);
      if (buffer.length > 64_000_000) throw new Error("解压后的推理输入过大");
      const request = JSON.parse(buffer.toString("utf8"));
      const fullInput = request.previous_response_id ? [...(known.get(request.previous_response_id) || []), ...(request.input || [])] : request.input || [];
      if (request.previous_response_id && !known.has(request.previous_response_id)) throw new Error("缺少连续任务上下文，拒绝无上下文重试");
      let providerInput=fullInput;
      if(tools?.verifyToolOutput&&Array.isArray(fullInput)){
        const calls=new Map();
        let resultBytes=0;
        providerInput=fullInput.map(item=>{
          if(item.type==='function_call')calls.set(item.call_id,item);
          if(item.type!=='function_call_output')return item;
          const call=calls.get(item.call_id),target=call&&catalog.get(call.namespace?`${call.namespace}_${call.name}`:call.name);
          if(!target)return item;
          const output=tools.verifyToolOutput({namespace:target.namespace,tool:target.name,arguments:parsedObject(call.arguments),callId:item.call_id},item.output);
          resultBytes+=Buffer.byteLength(typeof output==='string'?output:JSON.stringify(output));
          if(resultBytes>64_000_000)throw Error('完整工具上下文超过单次推理输入上限，请缩小资料范围');
          return {...item,output};
        });
      }
       // Cockpit's local Responses relay is SSE-only upstream. Under load it
       // can close before response.completed even when the request asked for
       // stream:false. Its chat-completions endpoint is the same model/account
       // pool but a complete HTTP response, so use that wire format locally;
       // the bridge still returns a Responses-compatible result to Codex.
       const localResponsesRelay = /^https?:\/\/(?:127\.0\.0\.1|localhost):(?:5317|9879)\/v1$/iu.test(String(settings.baseUrl || "").replace(/\/+$/u, ""));
       const chat = settings.protocol === "chat_completions" || localResponsesRelay;
      const anthropic = ["anthropic_messages", "messages"].includes(settings.protocol);
      const permittedNativeTools = forwardNativeTools ? request.tools : nativeWebSearchEnabled ? (request.tools || []).filter(tool => ["web_search", "web_search_preview"].includes(tool?.type)) : [];
      const providerTools = providerToolsFor(permittedNativeTools, functionTools);
      const chatProjection = chatToolProjection(providerTools);
      const anthropicProjection = anthropicToolProjection(providerTools);
      const input = Array.isArray(providerInput) ? providerInput.map((item) => item.type === "function_call" ? { ...item, name: item.namespace ? `${item.namespace}_${item.name}` : item.name, namespace: undefined } : item) : providerInput;
      const anthropicInput = anthropic ? responsesInputToAnthropic(providerInput, request.instructions) : null;
      const upstream = anthropic ? {
        model: settings.model,
        ...(anthropicInput.system ? { system: anthropicInput.system } : {}),
        messages: anthropicInput.messages,
        ...(anthropicProjection.tools.length ? { tools: anthropicProjection.tools } : {}),
        max_tokens: Number(settings.maxOutputTokens) || 12000,
      } : chat ? {
        model: settings.model, messages: responsesInputToChat(providerInput, request.instructions), tools: chatProjection.tools, tool_choice: "auto", stream: false, max_tokens: Number(settings.maxOutputTokens) || 12000,
       } : { ...request, model: settings.model, input, previous_response_id: undefined, tools: providerTools, store: false, stream: false, max_output_tokens: Number(settings.maxOutputTokens) || 12000 };
      const upstreamBody = JSON.stringify(upstream);
      requestDiagnostics = { bodyBytes: Buffer.byteLength(upstreamBody), inlineImageCount: (upstreamBody.match(/data:image\/[^;",]+;base64,/gu) || []).length };
      phase = "preflight";
      await onRequest({
        ...requestDiagnostics,
        model: settings.model,
        protocol: settings.protocol,
        toolCount: providerTools.length,
        requestedTools: (Array.isArray(request.tools) ? request.tools : []).map((tool) => ({ type: String(tool?.type || ""), name: String(tool?.name || "") })),
        forwardedTools: providerTools.map((tool) => ({ type: String(tool?.type || ""), name: String(tool?.name || "") })),
      });
      phase = "transport";
      const response = await fetchProvider(`${String(settings.baseUrl).replace(/\/+$/u, "")}/${anthropic ? "messages" : chat ? "chat/completions" : "responses"}`, {
        method: "POST",
        headers: anthropic
          ? { "content-type": "application/json", "anthropic-version": "2023-06-01", ...(settings.apiKey ? { "x-api-key": settings.apiKey } : {}) }
          : { "content-type": "application/json", ...(settings.apiKey ? { authorization: `Bearer ${settings.apiKey}` } : {}) },
        body: upstreamBody,
        signal: controller.signal,
      // Public inference must not be submitted twice after a transport failure.
      // Keep the private API/network policy unchanged.
      }, { fetchImpl, allowDirectFallback: !singleProviderAttempt && settings.credentialSource !== "public" });
      upstreamStatus = response.status;
      phase = "response";
      const raw = await response.text();
      let payload;
      try { payload = JSON.parse(raw); } catch {
        // Error pages are not model JSON. Preserve their HTTP status, but do
        // not echo HTML (which can contain gateway headers or request data).
        payload = { error: { code: "NON_JSON_RESPONSE", message: /^\s*</u.test(raw) ? "上游返回了网页错误页而非 JSON" : "上游返回了无法解析的非 JSON 响应" } };
      }
      if (!payload || typeof payload !== "object") payload = { error: { code: "INVALID_RESPONSE", message: "上游返回了无效的响应结构" } };
      if (!response.ok || payload.error) {
        lastFailure = { ...textProviderFailure({ status: response.ok ? 502 : response.status, observedHttpStatus: response.status, payload, retryAfter: response.headers.get("retry-after") || "", apiKey: settings.apiKey, includeProviderMetadata: settings.credentialSource === "public" }), requestDiagnostics };
        if(nativeWebSearchEnabled&&/web[_ .-]?search|联网搜索/i.test(JSON.stringify(payload))&&/unsupported|not supported|not allowed|unknown|invalid|不支持|不允许|不可用/i.test(JSON.stringify(payload)))lastFailure={...lastFailure,code:'WEB_SEARCH_UNAVAILABLE',message:'当前模型接口不支持联网搜索，请在对话中更换支持联网的模型配置。'};
        throw Object.assign(new Error(lastFailure.message), lastFailure);
      }
      const message = payload.choices?.[0]?.message || {};
      const anthropicContent = Array.isArray(payload.content) ? payload.content : [];
      const rawOutput = anthropic ? [
        ...anthropicContent.filter((part) => part?.type === "tool_use").map((part) => chatCallAsResponsesItem({
          id: part.id,
          type: "function",
          function: { name: part.name, arguments: JSON.stringify(part.input || {}) },
        }, anthropicProjection.calls)),
        ...(anthropicContent.some((part) => part?.type === "text" && String(part.text || "").trim()) ? [{
          type: "message",
          id: `msg_${randomUUID()}`,
          role: "assistant",
          status: "completed",
          content: anthropicContent.filter((part) => part?.type === "text" && String(part.text || "").trim()).map((part) => ({ type: "output_text", text: String(part.text), annotations: [] })),
        }] : []),
      ] : chat ? [
        ...(message.tool_calls || []).map((call) => chatCallAsResponsesItem(call, chatProjection.calls)),
        ...(contentText(message.content) ? [{ type: "message", id: `msg_${randomUUID()}`, role: "assistant", status: "completed", content: [{ type: "output_text", text: contentText(message.content), annotations: [] }] }] : []),
      ] : payload.output || [];
      const output = rawOutput.map((item) => {
        if (item.type !== "function_call") return item;
        if (item.namespace) return item;
        const target = catalog.get(item.name);
        if (!target) return item;
        return { ...item, name: target.name, namespace: target.namespace };
      });
      if (!output.length) throw new Error("上游没有返回文本或工具调用");
      const translatedUsage = anthropic
        ? { input_tokens: payload.usage?.input_tokens || 0, output_tokens: payload.usage?.output_tokens || 0, total_tokens: (payload.usage?.input_tokens || 0) + (payload.usage?.output_tokens || 0) }
        : chat ? { input_tokens: payload.usage?.prompt_tokens || 0, output_tokens: payload.usage?.completion_tokens || 0, total_tokens: payload.usage?.total_tokens || 0 } : payload.usage;
      const id = `resp_${randomUUID()}`, result = { id, object: "response", created_at: Math.floor(Date.now() / 1000), model: settings.model, status: "completed", output, usage: translatedUsage };
      known.set(id, [...(Array.isArray(fullInput) ? fullInput : [{ role: "user", content: fullInput }]), ...output]);
      if (known.size > 8) known.delete(known.keys().next().value);
      if (!request.stream) { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(result)); return; }
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      let seq = 0;
      const send = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, sequence_number: seq++, ...data })}\n\n`);
      send("response.created", { response: { ...result, status: "in_progress", output: [] } });
      output.forEach((item, index) => {
        const functionCall = item.type === "function_call";
        const customToolCall = item.type === "custom_tool_call";
        send("response.output_item.added", { output_index: index, item: functionCall ? { ...item, arguments: "", status: "in_progress" } : customToolCall ? { ...item, input: "", status: "in_progress" } : { ...item, content: [], status: "in_progress" } });
        if (item.type === "function_call") {
          send("response.function_call_arguments.delta", { output_index: index, item_id: item.id, delta: item.arguments });
          send("response.function_call_arguments.done", { output_index: index, item_id: item.id, arguments: item.arguments });
        } else if (customToolCall) {
          send("response.custom_tool_call_input.delta", { output_index: index, item_id: item.id, delta: item.input });
          send("response.custom_tool_call_input.done", { output_index: index, item_id: item.id, input: item.input });
        } else if (item.type === "message") item.content.forEach((part, content_index) => {
          send("response.content_part.added", { output_index: index, item_id: item.id, content_index, part: { ...part, text: "" } });
          send("response.output_text.delta", { output_index: index, item_id: item.id, content_index, delta: part.text });
          send("response.output_text.done", { output_index: index, item_id: item.id, content_index, text: part.text });
          send("response.content_part.done", { output_index: index, item_id: item.id, content_index, part });
        });
        send("response.output_item.done", { output_index: index, item });
      });
      send("response.completed", { response: result }); res.end();
    } catch (error) {
      if (!lastFailure) {
        const local = ["input", "preflight"].includes(phase), aborted = controller.signal.aborted;
        lastFailure = { code: aborted ? "ABORTED" : error.code || (local ? "TEXT_BRIDGE_INPUT_REJECTED" : "TEXT_PROVIDER_INVALID_RESPONSE"), statusCode: Number(error.statusCode) || (local ? 400 : 502),
          message: safeDetail(aborted ? "任务已停止，未自动重发请求" : `${local ? "本地推理校验未通过" : phase === "transport" ? "文字服务连接失败" : "文字服务响应读取失败"}：${error.message}；未自动重发本次请求`, settings.apiKey),
          providerHttpStatus: upstreamStatus, networkCode: String(error.networkCode || error.cause?.code || "").slice(0, 100), requestDiagnostics };
      }
      if (!res.headersSent) res.writeHead(lastFailure.statusCode, { "content-type": "application/json", ...(lastFailure.retryAfter ? { "retry-after": lastFailure.retryAfter } : {}) });
      res.end(JSON.stringify({ error: { code: lastFailure.code, message: lastFailure.message } }));
    } finally { controllers.delete(controller); signal?.removeEventListener("abort", abort); }
  });
  await new Promise((done, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", done); });
  return { url: `http://127.0.0.1:${server.address().port}/v1`, token, get lastFailure() { return lastFailure; }, close: async () => { for (const c of controllers) c.abort(); server.closeAllConnections(); await new Promise((done) => server.close(done)); } };
};
