/**
 * POST /api/mp/wechat/qrcode-bind
 *
 * 生成"绑定到服务号「Tend的小花」"的带参数二维码。
 *
 * 流程：
 *   1. mp 端点「绑定微信」→ 调本接口
 *   2. 本接口调微信 cgi-bin/qrcode/create，scene_str = user.id，30 分钟有效
 *   3. 返回 qrcode_url 给 mp，mp 展示一张图给用户
 *   4. 用户在微信内长按图片 → 识别 → 跳服务号关注页 → 点关注
 *   5. 服务号收到 subscribe 事件（带 EventKey=qrscene_<user.id>）
 *      → /api/wechat/event-callback 把该用户的 wechat_openid 写入 user_profiles
 *
 * Body: 无
 * Returns: { success, qrcode_url, expires_in }
 */

import { NextResponse, type NextRequest } from "next/server";
import { getUserFromBearer } from "@/lib/api-auth";
import { isWechatConfigured, callWechatApi } from "@/lib/wechat";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const EXPIRE_SECONDS = 30 * 60; // 30 分钟（微信带参数二维码最长 30 天，但临时二维码我们用半小时够了）

interface QrCodeCreateResp {
  ticket: string;
  expire_seconds: number;
  url?: string;
}

export async function POST(req: NextRequest) {
  const user = await getUserFromBearer(req);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  if (!isWechatConfigured()) {
    return NextResponse.json(
      {
        error: "服务端未配置微信公众号 AppID/AppSecret，请联系管理员",
        needs_config: true,
      },
      { status: 503 }
    );
  }

  try {
    const resp = await callWechatApi<QrCodeCreateResp>("/cgi-bin/qrcode/create", {
      expire_seconds: EXPIRE_SECONDS,
      action_name: "QR_STR_SCENE",
      action_info: {
        scene: {
          scene_str: user.id, // user.id 是 UUID 36 字符，<= 64 微信上限
        },
      },
    });

    const ticket = resp.ticket;
    if (!ticket) {
      console.error("[api/mp/wechat/qrcode-bind] 微信返回无 ticket", resp);
      return NextResponse.json(
        { error: "生成二维码失败：微信返回异常" },
        { status: 500 }
      );
    }

    const qrcodeUrl = `https://mp.weixin.qq.com/cgi-bin/showqrcode?ticket=${encodeURIComponent(
      ticket
    )}`;

    return NextResponse.json({
      success: true,
      qrcode_url: qrcodeUrl,
      expires_in: resp.expire_seconds ?? EXPIRE_SECONDS,
    });
  } catch (err) {
    console.error("[api/mp/wechat/qrcode-bind] fail", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "生成二维码失败（微信接口报错），请稍后重试",
      },
      { status: 500 }
    );
  }
}
