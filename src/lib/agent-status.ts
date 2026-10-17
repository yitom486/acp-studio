/**
 * ACP session/update → 气泡状态文案。
 *
 * 这里集中维护「后端此刻在做什么」到「界面上怎么说」的映射。
 * 每个分支都对应 ACP 协议里真实存在的 update 类型（sessionUpdate），
 * 不再像早期实现那样轮播一份凭空捏造的阶段列表。
 *
 * 约定：返回 null 表示该事件不值得占用状态位——高频 chunk、纯信息同步、
 * 生命周期收尾等，都不应该把上一条更有信息量的文案顶掉。
 */

export interface StatusContext {
  /** 工具显示名（调用/更新事件） */
  title?: string;
  /** 工具状态：pending / in_progress / running / completed / failed / cancelled */
  status?: string;
  /** 会话状态：running / requires_action / idle */
  state?: string;
  /** plan 条目（用于显示完成度） */
  entries?: ReadonlyArray<{ status?: string }>;
  /** 当前模式 id */
  mode?: string;
  /** notice 原文 */
  message?: string;
  /** 子智能体标题 */
  subagentTitle?: string;
}

const TOOL_ACTIVE = new Set(["pending", "in_progress", "running"]);

function toolDoneText(title: string, status?: string): string {
  if (status === "failed") return `${title} 失败`;
  if (status === "cancelled") return `${title} 已取消`;
  return `${title} 已完成`;
}

function planText(entries?: ReadonlyArray<{ status?: string }>): string | null {
  if (!entries || entries.length === 0) return null;
  const done = entries.filter((e) => e.status === "completed").length;
  return `执行计划 ${done}/${entries.length}`;
}

/**
 * @param kind ACP `sessionUpdate` 类型（或本地合成的 activity kind）
 * @param ctx  该事件里与文案相关的字段
 */
export function statusTextForUpdate(kind: string, ctx: StatusContext = {}): string | null {
  switch (kind) {
    // ── 会话状态机 ──────────────────────────────────────────────
    case "state_update":
      if (ctx.state === "requires_action") return "等待确认操作…";
      if (ctx.state === "running") return "正在生成回复…";
      return null; // idle：由调用方清空状态位

    // ── 工具调用 ────────────────────────────────────────────────
    case "tool_call":
      return ctx.title ? `正在调用 ${ctx.title}…` : "正在调用工具…";
    case "tool_call_update": {
      const title = ctx.title || "工具";
      if (TOOL_ACTIVE.has(ctx.status ?? "")) return `正在执行 ${title}…`;
      if (!ctx.status) return `正在执行 ${title}…`;
      return toolDoneText(title, ctx.status);
    }

    // ── 计划 ────────────────────────────────────────────────────
    case "plan":
    case "plan_update":
      return planText(ctx.entries);
    case "plan_removed":
      return null;

    // ── 配置 / 会话信息 ─────────────────────────────────────────
    case "current_mode_update":
    case "available_commands_update":
    case "session_info_update":
    case "config_option_update":
    case "config_options_update":
      return null; // 纯配置/信息同步，不是「正在做什么」，不该抢状态位

    // ── 上下文压缩 ──────────────────────────────────────────────
    case "compaction_update":
    case "compaction_summary_chunk":
      return "正在压缩上下文…";

    // ── 子智能体 ────────────────────────────────────────────────
    case "subagent_active":
      return `${ctx.subagentTitle || "子智能体"} 协同处理中…`;

    // ── 后端提示 ────────────────────────────────────────────────
    case "notice":
      return ctx.message?.trim() || null;

    // 高频正文/思考 chunk 与用量更新不占用状态位
    default:
      return null;
  }
}

/** 启动阶段写入的过渡文案，允许被后续事件覆盖。 */
export function isBootstrapHint(hint: string | undefined): boolean {
  if (!hint) return true;
  return /连接|通道|启动|建立|规划|等待响应|创建会话/.test(hint);
}
