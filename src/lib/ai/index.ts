import { AnthropicProvider } from "./anthropic";
import { DashScopeProvider } from "./dashscope";
import { VisionProvider, VisionProviderError } from "./types";

export * from "./types";

/**
 * 选择当前应使用的视觉识别 Provider。
 *
 * 选择规则（按优先级）：
 * 1. 显式环境变量 AI_PROVIDER=dashscope | anthropic
 * 2. 否则：若 DASHSCOPE_API_KEY 存在则用 dashscope（境内首选）
 * 3. 否则：若 ANTHROPIC_API_KEY 存在则用 anthropic
 * 4. 都不存在 → 抛错
 */
export function getVisionProvider(): VisionProvider {
  const explicit = process.env.AI_PROVIDER?.toLowerCase();
  const dashscopeKey = process.env.DASHSCOPE_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  if (explicit === "dashscope") {
    if (!dashscopeKey) {
      throw new VisionProviderError(
        "AI_PROVIDER=dashscope 但未配置 DASHSCOPE_API_KEY",
        503,
        "服务端未配置阿里通义 API Key，请联系管理员"
      );
    }
    return new DashScopeProvider(dashscopeKey);
  }

  if (explicit === "anthropic") {
    if (!anthropicKey) {
      throw new VisionProviderError(
        "AI_PROVIDER=anthropic 但未配置 ANTHROPIC_API_KEY",
        503,
        "服务端未配置 Anthropic API Key，请联系管理员"
      );
    }
    return new AnthropicProvider(anthropicKey);
  }

  if (dashscopeKey) return new DashScopeProvider(dashscopeKey);
  if (anthropicKey) return new AnthropicProvider(anthropicKey);

  throw new VisionProviderError(
    "未配置任何 AI Provider 密钥",
    503,
    "服务端未配置 AI 服务，请联系管理员"
  );
}
