import {createAgentToolOutputVerifier} from './agent-tool-output.mjs';
// Native Codex now owns namespaces such as skills.read. A translated provider
// response must not be dispatched to that native tool instead of Shensi's
// document/Skill host. Give all dynamic tools a private wire namespace and
// translate only at the host boundary; business tool names remain unchanged.
export const codexWorkspaceTools = (runtime) => {
  if (!runtime) return { runtime: null, instructions: "", originalEvent: event => event };
  const names = new Map((runtime.dynamicTools || []).map(ns => [`shensi_host_${ns.name}`, ns.name]));
  const dynamicTools = (runtime.dynamicTools || []).map(ns => ({ ...ns, name: `shensi_host_${ns.name}` }));
  const verifier=createAgentToolOutputVerifier();
  return {
    runtime: {
      ...runtime, dynamicTools,
      verifyToolOutput: (call,output)=>verifier.verify(call,output),
      invoke: async ({ namespace, ...args }) => {
        if (!names.has(namespace)) throw new Error("未登记的神思工具命名空间");
        return verifier.relay({namespace,...args},await runtime.invoke({ ...args, namespace: names.get(namespace) }));
      },
    },
    instructions: `本轮神思工具使用独立命名空间，避免和运行器内置工具重名。资料中的工具名称按以下对应关系调用：${[...names].map(([wire, original]) => `${original}.* → ${wire}.*`).join("；")}。工具含义、权限、参数保持不变，不使用同名的运行器内置工具替代。`,
    originalEvent: (event) => {
      if (typeof event?.name !== "string") return event;
      const [namespace, ...rest] = event.name.split(".");
      return names.has(namespace) ? { ...event, name: [names.get(namespace), ...rest].join(".") } : event;
    },
  };
};
