/**
 * 中文 PDF 字体路径解析。
 *
 * pdfkit 默认只支持 Latin 字符（Helvetica/Times/Courier）。
 * 渲染中文必须 registerFont 一个 TTF/OTF/TTC。
 *
 * 解析策略（按优先级）：
 *   1. process.env.ECONTRACT_CJK_FONT_PATH         — 显式 override
 *   2. /usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc       — Debian apt install fonts-noto-cjk
 *   3. /usr/share/fonts/truetype/wqy/wqy-microhei.ttc               — Debian apt install fonts-wqy-microhei
 *   4. /usr/share/fonts/truetype/arphic/uming.ttc                   — Debian apt install fonts-arphic-uming
 *   5. C:/Windows/Fonts/msyh.ttc                                    — Windows 微软雅黑
 *   6. C:/Windows/Fonts/simhei.ttf                                  — Windows 黑体
 *   7. public/fonts/NotoSansSC-Regular.ttf                          — 项目自带（用户手动放）
 *
 * 若都找不到，抛出明确错误指引用户安装中文字体。
 */

import { existsSync } from "fs";
import path from "path";

interface FontCandidate {
  /** 文件路径 */
  file: string;
  /** TTC 文件需指定 family 名；TTF/OTF 留空 */
  family?: string;
}

function projectRoot(): string {
  return process.cwd();
}

function candidates(): FontCandidate[] {
  const envPath = process.env.ECONTRACT_CJK_FONT_PATH;
  return [
    ...(envPath ? [{ file: envPath }] : []),
    { file: "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc", family: "Noto Sans CJK SC" },
    { file: "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",         family: "WenQuanYi Micro Hei" },
    { file: "/usr/share/fonts/truetype/arphic/uming.ttc",             family: "AR PL UMing CN" },
    { file: "C:/Windows/Fonts/msyh.ttc",                              family: "Microsoft YaHei" },
    { file: "C:/Windows/Fonts/simhei.ttf" },
    { file: path.join(projectRoot(), "public", "fonts", "NotoSansSC-Regular.ttf") },
  ];
}

/** 返回第一个存在的字体候选；找不到抛错。*/
export function resolveCjkFont(): FontCandidate {
  for (const c of candidates()) {
    if (existsSync(c.file)) return c;
  }
  throw new Error(
    "未找到可用的中文字体。请在 ECS 上 `apt install fonts-noto-cjk`，" +
    "或在项目 public/fonts/ 放 NotoSansSC-Regular.ttf，" +
    "或设环境变量 ECONTRACT_CJK_FONT_PATH 指向 .ttf/.otf 文件。"
  );
}
