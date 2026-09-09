export type SupportedAIProvider =
  | "replit-managed"
  | "server-gemini"
  | "openai"
  | "claude"
  | "gemini"
  | "emergent"
  | "replit"
  | "other";

export interface AIProviderConfig {
  provider: SupportedAIProvider;
  apiKey?: string;
  customBase?: string;
  model?: string;
}

export interface UserAIKeysConfig {
  activeProvider: SupportedAIProvider;
  openai: {
    apiKey: string;
    model: string;
    customBase?: string;
  };
  claude: {
    apiKey: string;
    model: string;
  };
  gemini: {
    apiKey: string;
    model: string;
  };
  emergent: {
    apiKey: string;
    model: string;
    customBase: string;
  };
  replit: {
    apiKey: string;
    model: string;
    customBase: string;
  };
  other: {
    apiKey: string;
    model: string;
    customBase: string;
  };
}

export const DEFAULT_AI_KEYS_CONFIG: UserAIKeysConfig = {
  activeProvider: "replit-managed",
  openai: {
    apiKey: "",
    model: "gpt-4o-mini",
    customBase: "https://api.openai.com/v1",
  },
  claude: {
    apiKey: "",
    model: "claude-3-7-sonnet-20250219",
  },
  gemini: {
    apiKey: "",
    model: "gemini-3.7-flash",
  },
  emergent: {
    apiKey: "",
    model: "gpt-4o-mini",
    customBase: "https://api.emergent.sh/v1",
  },
  replit: {
    apiKey: "",
    model: "replit-code-v1_5-3b",
    customBase: "https://api.replit.com/ai/v1",
  },
  other: {
    apiKey: "",
    model: "gpt-4o-mini",
    customBase: "https://openrouter.ai/api/v1",
  },
};

export const OPENROUTER_DEFAULT_BASE = "https://openrouter.ai/api/v1";
const OPENROUTER_KEY_PREFIX = "sk-or-v1-";
const DIRECT_AI_PROVIDERS = ["other", "openai", "claude", "gemini", "emergent", "replit"] as const;
let openRouterRequestQueue: Promise<void> = Promise.resolve();
let lastOpenRouterRequestAt = 0;

export function isOpenRouterApiKey(value?: string): boolean {
  return value?.trim().startsWith(OPENROUTER_KEY_PREFIX) ?? false;
}

function getConfiguredDirectProvider(keys: Partial<UserAIKeysConfig>): (typeof DIRECT_AI_PROVIDERS)[number] | undefined {
  return DIRECT_AI_PROVIDERS.find((provider) => Boolean(keys[provider]?.apiKey?.trim()));
}

function getOpenRouterKeySource(
  keys: Partial<UserAIKeysConfig>
): { apiKey: string; model: string } | undefined {
  const sourceProvider = DIRECT_AI_PROVIDERS.find((provider) =>
    isOpenRouterApiKey(keys[provider]?.apiKey)
  );
  if (!sourceProvider) return undefined;

  const source = keys[sourceProvider];
  return {
    apiKey: source?.apiKey?.trim() || "",
    model: source?.model?.trim() || "openai/gpt-4o-mini",
  };
}

function enqueueOpenRouterRequest<T>(request: () => Promise<T>): Promise<T> {
  const queuedRequest = openRouterRequestQueue.then(async () => {
    const elapsed = Date.now() - lastOpenRouterRequestAt;
    const waitMs = Math.max(0, 500 - elapsed);
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    lastOpenRouterRequestAt = Date.now();
    return request();
  });

  openRouterRequestQueue = queuedRequest.then(
    () => undefined,
    () => undefined
  );
  return queuedRequest;
}

export function getActiveAIConfig(keys?: Partial<UserAIKeysConfig> | null): AIProviderConfig {
  if (!keys) return { provider: "replit-managed", model: "gpt-5.6-terra" };

  // The managed provider is the application default and must not be overridden
  // merely because an optional provider key remains saved in the browser.
  if (keys.activeProvider === "replit-managed") {
    return { provider: "replit-managed", model: "gpt-5.6-terra" };
  }

  // Use a saved OpenRouter key only when the user has explicitly selected an
  // optional provider instead of Managed AI.
  const openRouterKey = keys.activeProvider !== "server-gemini" ? getOpenRouterKeySource(keys) : undefined;
  if (openRouterKey && keys.activeProvider === "other") {
    return {
      provider: "other",
      apiKey: openRouterKey.apiKey,
      model: openRouterKey.model,
      customBase: OPENROUTER_DEFAULT_BASE,
    };
  }

  // Older saved sessions may still say server-gemini even though a direct
  // provider key was entered. Never route those saved keys to Gemini.
  const active =
    keys.activeProvider === "server-gemini"
      ? getConfiguredDirectProvider(keys) || "replit-managed"
      : keys.activeProvider || "server-gemini";

  if (
    active !== "replit-managed" &&
    active !== "server-gemini" &&
    !keys[active]?.apiKey?.trim()
  ) {
    return { provider: "replit-managed", model: "gpt-5.6-terra" };
  }

  switch (active) {
    case "openai":
      return {
        provider: "openai",
        apiKey: keys.openai?.apiKey?.trim() || "",
        model: keys.openai?.model || "gpt-4o-mini",
        customBase: keys.openai?.customBase?.trim() || "https://api.openai.com/v1",
      };
    case "claude":
      return {
        provider: "claude",
        apiKey: keys.claude?.apiKey?.trim() || "",
        model: keys.claude?.model || "claude-3-7-sonnet-20250219",
      };
    case "gemini":
      return {
        provider: "gemini",
        apiKey: keys.gemini?.apiKey?.trim() || "",
        model: keys.gemini?.model || "gemini-3.7-flash",
      };
    case "emergent":
      return {
        provider: "emergent",
        apiKey: keys.emergent?.apiKey?.trim() || "",
        model: keys.emergent?.model || "gpt-4o-mini",
        customBase: keys.emergent?.customBase?.trim() || "https://api.emergent.sh/v1",
      };
    case "replit":
      return {
        provider: "replit",
        apiKey: keys.replit?.apiKey?.trim() || "",
        model: keys.replit?.model || "replit-code-v1_5-3b",
        customBase: keys.replit?.customBase?.trim() || "https://api.replit.com/ai/v1",
      };
    case "other":
      return {
        provider: "other",
        apiKey: keys.other?.apiKey?.trim() || "",
        model: keys.other?.model || "gpt-4o-mini",
        customBase: keys.other?.customBase?.trim() || OPENROUTER_DEFAULT_BASE,
      };
    case "server-gemini":
    default:
      return {
        provider: "replit-managed",
        model: "gpt-5.6-terra",
      };
  }
}

async function readAIResponseJson(res: Response, providerName: string): Promise<any> {
  const responseText = await res.text();

  if (!responseText.trim()) {
    throw new Error(
      `${providerName} returned an empty response (HTTP ${res.status}). Check the API key, model name, endpoint URL, and provider quota.`
    );
  }

  try {
    return JSON.parse(responseText);
  } catch {
    const contentType = res.headers.get("content-type") || "unknown content type";
    throw new Error(
      `${providerName} returned an invalid response (HTTP ${res.status}, ${contentType}). Check the endpoint URL and provider availability.`
    );
  }
}

export async function callAI(
  prompt: string,
  systemInstruction?: string,
  config?: AIProviderConfig,
  maxTokens: number = 3500
): Promise<string> {
  const provider = config?.provider || "replit-managed";
  const apiKey = config?.apiKey?.trim() || "";
  const customBase = config?.customBase?.trim() || "";
  let model = config?.model || "";

  // Normalize model name if it references old Gemini models
  if (model.includes("gemini-2.5") || model.includes("gemini-2.0") || model.includes("gemini-1.5")) {
    model = "gemini-3.7-flash";
  }

  // 1. Replit-managed OpenAI integration. The key stays server-side.
  if (provider === "replit-managed") {
    const res = await fetch("/api/prisma/ai/generate", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        systemInstruction,
        model: model || "gpt-5.6-terra",
        maxOutputTokens: maxTokens,
        temperature: 0.3,
      }),
    });
    const data = await readAIResponseJson(res, "Replit-managed AI");
    if (!res.ok || data.error) throw new Error(data.error || `Server error (${res.status})`);
    return data.text || "";
  }

  // 2. Server-side Gemini endpoint (optional legacy provider)
  if (provider === "server-gemini" || (!apiKey && provider === "gemini")) {
    const res = await fetch("/prisma-api/gemini/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        systemInstruction,
        model: model || "gemini-3.7-flash",
        maxOutputTokens: maxTokens,
        temperature: 0.3,
      }),
    });
    const data = await readAIResponseJson(res, "Server Gemini");
    if (!res.ok || data.error) {
      throw new Error(data.error || `Server error (${res.status})`);
    }
    return data.text || "";
  }

  // 2. Direct Anthropic Claude
  if (provider === "claude") {
    if (!apiKey) {
      throw new Error(
        "Anthropic Claude API key is required. Please add your key (sk-ant-...) in the AI Providers & API Keys tab."
      );
    }
    const chosenModel = model || "claude-3-7-sonnet-20250219";
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: chosenModel,
        max_tokens: maxTokens,
        system: systemInstruction || "",
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const data = await readAIResponseJson(res, "Anthropic Claude");
    if (data.error) throw new Error(data.error.message || "Claude API error");
    return (data.content || []).map((b: any) => b.text || "").join("\n");
  }

  // 3. Direct Gemini (Client key)
  if (provider === "gemini" && apiKey) {
    const chosenModel = model || "gemini-3.7-flash";
    const sysText = systemInstruction ? systemInstruction + "\n\n" : "";
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${chosenModel}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: sysText + prompt }] }],
          generationConfig: { maxOutputTokens: maxTokens, temperature: 0.3 },
        }),
      }
    );
    const data = await readAIResponseJson(res, "Google Gemini");
    if (data.error) throw new Error(data.error.message || `Gemini API error: ${JSON.stringify(data.error)}`);
    return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  }

  // 4. OpenAI, Emergent, Replit, or other OpenAI-compatible endpoints
  if (
    provider === "openai" ||
    provider === "emergent" ||
    provider === "replit" ||
    provider === "other"
  ) {
    if (!apiKey) {
      const name =
        provider === "openai"
          ? "OpenAI"
          : provider === "emergent"
          ? "Emergent"
          : provider === "replit"
          ? "Replit"
          : "Custom AI";
      throw new Error(`${name} API key is required. Please provide your key in the AI Providers & API Keys tab.`);
    }

    let defaultBase = "https://api.openai.com/v1";
    if (provider === "emergent") defaultBase = "https://api.emergent.sh/v1";
    if (provider === "replit") defaultBase = "https://api.replit.com/ai/v1";
    if (provider === "other") defaultBase = "https://openrouter.ai/api/v1";

    const base = customBase || defaultBase;
    // Keep OpenRouter requests within a small-credit balance. The previous
    // 3500-token request can be rejected before generation when the account
    // can only afford a smaller maximum output.
    const requestMaxTokens = base.includes("openrouter.ai") ? Math.min(maxTokens, 2000) : maxTokens;
    const chosenModel =
      model ||
      (provider === "replit"
        ? "replit-code-v1_5-3b"
        : provider === "openai"
        ? "gpt-4o-mini"
        : "gpt-4o-mini");

    const messages: any[] = [];
    if (systemInstruction) messages.push({ role: "system", content: systemInstruction });
    messages.push({ role: "user", content: prompt });

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    };

    const request = async () => {
      const res = await fetch(`${base.replace(/\/+$/, "")}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: chosenModel,
          messages,
          max_tokens: requestMaxTokens,
          temperature: 0.3,
        }),
      });
      const data = await readAIResponseJson(res, `${provider} AI`);
      if (data.error) throw new Error(data.error.message || `API error (${res.status}): ${JSON.stringify(data.error)}`);
      return data.choices?.[0]?.message?.content || "";
    };

    return base.includes("openrouter.ai") ? enqueueOpenRouterRequest(request) : request();
  }

  throw new Error(`Unsupported AI provider: ${provider}`);
}

export async function testAIConnection(
  config: AIProviderConfig
): Promise<{ success: boolean; message: string; latencyMs: number }> {
  const startTime = Date.now();
  try {
    const res = await callAI(
      "Ping test. Please reply with 'OK: Connection verified.' in one short sentence.",
      "You are an automated API connection tester.",
      config,
      60
    );
    const latency = Date.now() - startTime;
    return {
      success: true,
      message: res.trim() || "Connected successfully.",
      latencyMs: latency,
    };
  } catch (err: any) {
    const latency = Date.now() - startTime;
    return {
      success: false,
      message: err.message || "Connection failed.",
      latencyMs: latency,
    };
  }
}

export function parseJSONLoose(text: string): any {
  if (!text) return null;
  const cleaned = text.replace(/```json/g, "").replace(/```/g, "").trim();
  const startObj = cleaned.indexOf("{");
  const startArr = cleaned.indexOf("[");
  let start = -1;
  if (startObj !== -1 && startArr !== -1) {
    start = Math.min(startObj, startArr);
  } else if (startObj !== -1) {
    start = startObj;
  } else if (startArr !== -1) {
    start = startArr;
  }

  try {
    return JSON.parse(cleaned);
  } catch {
    if (start !== -1) {
      try {
        return JSON.parse(cleaned.slice(start));
      } catch {
        const lastObj = cleaned.lastIndexOf("}");
        const lastArr = cleaned.lastIndexOf("]");
        const end = Math.max(lastObj, lastArr);
        if (end > start) {
          try {
            return JSON.parse(cleaned.slice(start, end + 1));
          } catch {
            return null;
          }
        }
        return null;
      }
    }
    return null;
  }
}
