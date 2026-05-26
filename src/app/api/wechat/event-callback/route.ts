/**
 * 微信公众号「服务器配置」消息回调
 *
 * GET  /api/wechat/event-callback
 *     微信首次启用「服务器配置」时验证服务器：
 *       echo back echostr if signature 正确
 *
 * POST /api/wechat/event-callback
 *     微信推送用户事件（关注/取消关注/扫码/消息等），
 *     我们只关心 subscribe + SCAN 事件 + 带 scene_str（来自带参数二维码）。
 *
 *     收到关注时：根据 scene_str = user.id 把 FromUserName(OpenID)
 *     绑定到对应账号 user_profiles。
 *
 * 微信文档：
 *   - 接入指南: https://developers.weixin.qq.com/doc/offiaccount/Basic_Information/Access_Overview.html
 *   - 关注事件: https://developers.weixin.qq.com/doc/offiaccount/Message_Management/Receiving_event_pushes.html
 *
 * 必须 5 秒内响应（否则微信重试）。回复必须是 XML（或字符串 "success"）。
 */

import { type NextRequest } from "next/server";
import { createHash } from "node:crypto";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ============================================================
// 签名校验
// ============================================================

/**
 * 微信校验签名规则：
 *   1. token + timestamp + nonce 三个值字典排序
 *   2. 拼接后 sha1
 *   3. 与 signature 比较
 */
function verifySignature(
  token: string,
  timestamp: string,
  nonce: string,
  signature: string
): boolean {
  const arr = [token, timestamp, nonce].sort();
  const sha1 = createHash("sha1").update(arr.join("")).digest("hex");
  return sha1 === signature;
}

// ============================================================
// GET：服务器配置验证
// ============================================================

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const signature = url.searchParams.get("signature") ?? "";
  const timestamp = url.searchParams.get("timestamp") ?? "";
  const nonce = url.searchParams.get("nonce") ?? "";
  const echostr = url.searchParams.get("echostr") ?? "";

  const token = process.env.WECHAT_EVENT_TOKEN;
  if (!token) {
    console.error("[wechat/event-callback GET] WECHAT_EVENT_TOKEN 未配置");
    return new Response("server misconfigured", { status: 500 });
  }

  if (!verifySignature(token, timestamp, nonce, signature)) {
    console.warn("[wechat/event-callback GET] 签名校验失败", {
      timestamp,
      nonce,
      signature,
    });
    return new Response("invalid signature", { status: 401 });
  }

  // 验证通过：原样返回 echostr 给微信
  return new Response(echostr, {
    status: 200,
    headers: { "Content-Type": "text/plain" },
  });
}

// ============================================================
// POST：接收事件推送
// ============================================================

/**
 * 极简 XML 提取（微信推送的 XML 结构固定，标签都是单层 <Key>val</Key>）。
 * 不引入 xml2js 之类的依赖，避免 cold start 变慢。
 */
function pickXml(xml: string, tag: string): string | null {
  const cdataRe = new RegExp(`<${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`);
  const plainRe = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`);
  const m = xml.match(cdataRe) ?? xml.match(plainRe);
  return m ? m[1] : null;
}

interface WechatEvent {
  ToUserName: string;
  FromUserName: string; // 用户的 OA OpenID
  CreateTime: string;
  MsgType: string; // event / text / image ...
  Event?: string; // subscribe / unsubscribe / SCAN
  EventKey?: string; // 关注：qrscene_<scene_str>；已关注扫码：<scene_str>
  Ticket?: string;
}

function parseEvent(xml: string): WechatEvent {
  return {
    ToUserName: pickXml(xml, "ToUserName") ?? "",
    FromUserName: pickXml(xml, "FromUserName") ?? "",
    CreateTime: pickXml(xml, "CreateTime") ?? "",
    MsgType: pickXml(xml, "MsgType") ?? "",
    Event: pickXml(xml, "Event") ?? undefined,
    EventKey: pickXml(xml, "EventKey") ?? undefined,
    Ticket: pickXml(xml, "Ticket") ?? undefined,
  };
}

/**
 * 从 EventKey 提取 scene_str
 *   - 关注事件: EventKey = "qrscene_<scene_str>"
 *   - 已关注用户扫码: EventKey = "<scene_str>"（没有 qrscene_ 前缀）
 */
function extractSceneStr(event: WechatEvent): string | null {
  const key = event.EventKey ?? "";
  if (!key) return null;
  return key.startsWith("qrscene_") ? key.slice("qrscene_".length) : key;
}

/**
 * 把 OpenID 写入 user_profiles。同时清掉别的账号占用同一个 OpenID 的情况（极少见）。
 */
async function bindOpenidToUser(userId: string, openid: string): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("Supabase 服务端配置缺失");
  }
  const admin = createSupabaseClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 校验 userId 是真实存在的（防止恶意构造 scene_str）
  const { data: existing } = await admin
    .from("user_profiles")
    .select("id")
    .eq("id", userId)
    .maybeSingle();
  if (!existing) {
    throw new Error(`scene_str 对应的 user_id 不存在：${userId}`);
  }

  // 先把别的账号占用同 openid 的清掉（避免冲突）
  await admin
    .from("user_profiles")
    .update({
      wechat_openid: null,
      wechat_nickname: null,
      wechat_bound_at: null,
      wechat_subscribed: false,
    })
    .eq("wechat_openid", openid)
    .neq("id", userId);

  // 绑定到当前 userId
  const { error: upErr } = await admin
    .from("user_profiles")
    .update({
      wechat_openid: openid,
      wechat_bound_at: new Date().toISOString(),
      wechat_subscribed: true,
    })
    .eq("id", userId);

  if (upErr) {
    throw new Error(`绑定 OpenID 失败：${upErr.message}`);
  }
}

/**
 * 构造回复 XML（关注成功后给用户的欢迎消息）。
 * 即使我们不想回复消息，也必须返回 "success" 字符串或合法 XML，
 * 否则微信会重试 3 次 + 在调试日志里报"该公众号暂时无法提供服务"。
 */
function buildTextReply(
  toOpenid: string,
  fromUsername: string,
  content: string
): string {
  return `<xml>
  <ToUserName><![CDATA[${toOpenid}]]></ToUserName>
  <FromUserName><![CDATA[${fromUsername}]]></FromUserName>
  <CreateTime>${Math.floor(Date.now() / 1000)}</CreateTime>
  <MsgType><![CDATA[text]]></MsgType>
  <Content><![CDATA[${content}]]></Content>
</xml>`;
}

export async function POST(req: NextRequest) {
  // 1. 校验签名（POST 也要校验，防止伪造）
  const url = new URL(req.url);
  const signature = url.searchParams.get("signature") ?? "";
  const timestamp = url.searchParams.get("timestamp") ?? "";
  const nonce = url.searchParams.get("nonce") ?? "";
  const token = process.env.WECHAT_EVENT_TOKEN;
  if (token && !verifySignature(token, timestamp, nonce, signature)) {
    console.warn("[wechat/event-callback POST] 签名校验失败");
    return new Response("invalid signature", { status: 401 });
  }

  // 2. 读 XML
  let xml: string;
  try {
    xml = await req.text();
  } catch {
    return new Response("invalid body", { status: 400 });
  }

  const event = parseEvent(xml);
  const fromOpenid = event.FromUserName;
  const toUsername = event.ToUserName; // 服务号原始 ID

  // 3. 只处理 subscribe + SCAN（带参数二维码）
  const isSubscribe = event.MsgType === "event" && event.Event === "subscribe";
  const isScan = event.MsgType === "event" && event.Event === "SCAN";

  if (!isSubscribe && !isScan) {
    // 其它事件（取消关注/点击菜单/文本消息等）我们不处理，直接 success 让微信不重试
    return new Response("success", { status: 200 });
  }

  const sceneStr = extractSceneStr(event);

  // 关注但没带场景值：可能是用户自己搜索关注的，不绑定
  if (!sceneStr) {
    if (isSubscribe) {
      return new Response(
        buildTextReply(
          fromOpenid,
          toUsername,
          "欢迎关注养房 Tend！请在小程序「我的 → 微信自动提醒」点绑定按钮，才能收到账单提醒。"
        ),
        { headers: { "Content-Type": "application/xml" } }
      );
    }
    return new Response("success", { status: 200 });
  }

  // 有场景值：尝试绑定
  let replyContent = "";
  try {
    await bindOpenidToUser(sceneStr, fromOpenid);
    replyContent = isSubscribe
      ? "🎉 已为你开启自动提醒！\n\n以后账单到期、租约到期、抄表提醒都会通过本服务号推送给你。"
      : "✅ 微信绑定已刷新，自动提醒已开启。";
  } catch (err) {
    console.error("[wechat/event-callback POST] bind fail", err, {
      sceneStr,
      fromOpenid,
    });
    replyContent = isSubscribe
      ? "欢迎关注养房 Tend！绑定遇到问题，请回到小程序重新扫描二维码。"
      : "绑定遇到问题，请回小程序重新扫码";
  }

  return new Response(buildTextReply(fromOpenid, toUsername, replyContent), {
    status: 200,
    headers: { "Content-Type": "application/xml" },
  });
}
