import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT_DIR = join(ROOT, "软著申请材料");

// 用户后续可在 软著申请材料/screenshots/ 下放真实截图，命名 01-login.png 等
// 这里若图存在则嵌入，否则留占位灰框
function imgOrPlaceholder(filename, alt, width = 280) {
  const path = join(OUT_DIR, "screenshots", filename);
  if (existsSync(path)) {
    const buf = readFileSync(path);
    const base64 = buf.toString("base64");
    return `<img src="data:image/png;base64,${base64}" alt="${alt}" style="max-width:${width}px;border:1px solid #ddd;border-radius:8px;" />`;
  }
  return `<div style="width:${width}px;height:${Math.round(width * 1.7)}px;background:#f4f4f4;border:1px dashed #bbb;border-radius:8px;display:inline-flex;align-items:center;justify-content:center;color:#999;font-size:12px;text-align:center;padding:8px;">[ 此处插入截图：<br/>${alt}<br/>文件名: ${filename} ]</div>`;
}

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>养房 Tend 软件操作手册 V1.0</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Microsoft YaHei", "苹方", sans-serif; font-size: 11pt; line-height: 1.7; color: #222; margin: 0; padding: 0; background: white; }
  .page { width: 210mm; min-height: 297mm; padding: 22mm 22mm 18mm 22mm; box-sizing: border-box; page-break-after: always; }
  .page:last-child { page-break-after: auto; }
  h1 { font-size: 26pt; color: #C8553D; margin: 0 0 8mm 0; padding-bottom: 4mm; border-bottom: 2px solid #C8553D; }
  h2 { font-size: 18pt; color: #C8553D; margin: 8mm 0 4mm 0; padding-left: 8px; border-left: 5px solid #C8553D; }
  h3 { font-size: 14pt; color: #444; margin: 6mm 0 3mm 0; }
  p { margin: 0 0 3mm 0; text-align: justify; }
  ul, ol { margin: 0 0 4mm 0; padding-left: 6mm; }
  li { margin-bottom: 2mm; }
  .meta { color: #666; font-size: 10pt; margin-top: 4mm; }
  .center { text-align: center; }
  .screenshot-row { text-align: center; margin: 4mm 0; }
  .feature-card { background: #FBEEE9; border-left: 3px solid #C8553D; padding: 4mm 5mm; margin-bottom: 4mm; border-radius: 4px; }
  table { width: 100%; border-collapse: collapse; margin: 3mm 0; font-size: 10.5pt; }
  th, td { border: 1px solid #ddd; padding: 3mm; text-align: left; }
  th { background: #FBEEE9; color: #C8553D; }
  code { background: #f5f5f5; padding: 1px 5px; border-radius: 3px; font-family: Consolas, monospace; font-size: 10pt; }
  .toc { line-height: 2; }
  .toc-item { display: flex; justify-content: space-between; border-bottom: 1px dotted #ccc; }
  @media print { @page { size: A4; margin: 0; } .page { margin: 0; box-shadow: none; } }
</style>
</head>
<body>

<!-- ====== 封面 ====== -->
<div class="page" style="display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;">
  <div style="width:120px;height:120px;background:#FBEEE9;border-radius:24px;display:flex;align-items:center;justify-content:center;margin-bottom:30mm;">
    <svg viewBox="0 0 60 60" width="80" height="80" stroke="#C8553D" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="3">
      <path d="M11 52 V32 L30 20 L49 32 V52 Z"/>
      <path d="M30 22 Q30 14 30 9"/>
      <path d="M30 14 Q24 13 22 17 Q26 19 30 16" fill="#C8553D" fill-opacity="0.85" stroke="none"/>
      <path d="M30 11 Q35 10 37 13 Q34 16 30 13" fill="#C8553D" stroke="none"/>
    </svg>
  </div>
  <h1 style="font-size:36pt;border:none;">养房 Tend</h1>
  <p style="font-size:18pt;color:#666;margin-top:4mm;">AI 房东助手</p>
  <p style="font-size:14pt;color:#888;margin-top:2mm;">让管理几套房，像养一盆花一样轻松</p>
  <div style="margin-top:60mm;font-size:14pt;color:#444;">
    <p>软件操作手册</p>
    <p>V1.0</p>
  </div>
  <div style="margin-top:40mm;font-size:11pt;color:#888;">
    <p>${new Date().getFullYear()} 年 ${new Date().getMonth() + 1} 月</p>
  </div>
</div>

<!-- ====== 目录 ====== -->
<div class="page">
  <h1>目  录</h1>
  <div class="toc">
    <div class="toc-item"><span>第一章 &nbsp; 软件概述</span><span>3</span></div>
    <div class="toc-item"><span>第二章 &nbsp; 运行环境</span><span>4</span></div>
    <div class="toc-item"><span>第三章 &nbsp; 功能模块</span><span>5</span></div>
    <div class="toc-item"><span>&nbsp;&nbsp;&nbsp;&nbsp;3.1 用户登录与注册</span><span>5</span></div>
    <div class="toc-item"><span>&nbsp;&nbsp;&nbsp;&nbsp;3.2 首页概览</span><span>6</span></div>
    <div class="toc-item"><span>&nbsp;&nbsp;&nbsp;&nbsp;3.3 房源管理</span><span>7</span></div>
    <div class="toc-item"><span>&nbsp;&nbsp;&nbsp;&nbsp;3.4 租客管理</span><span>8</span></div>
    <div class="toc-item"><span>&nbsp;&nbsp;&nbsp;&nbsp;3.5 租约管理</span><span>9</span></div>
    <div class="toc-item"><span>&nbsp;&nbsp;&nbsp;&nbsp;3.6 账单管理</span><span>10</span></div>
    <div class="toc-item"><span>&nbsp;&nbsp;&nbsp;&nbsp;3.7 AI 收款截图识别</span><span>11</span></div>
    <div class="toc-item"><span>&nbsp;&nbsp;&nbsp;&nbsp;3.8 抄表记录</span><span>12</span></div>
    <div class="toc-item"><span>&nbsp;&nbsp;&nbsp;&nbsp;3.9 提醒中心</span><span>13</span></div>
    <div class="toc-item"><span>&nbsp;&nbsp;&nbsp;&nbsp;3.10 家庭组协作</span><span>14</span></div>
    <div class="toc-item"><span>第四章 &nbsp; 系统架构</span><span>15</span></div>
  </div>
</div>

<!-- ====== 第一章 软件概述 ====== -->
<div class="page">
  <h1>第一章 &nbsp; 软件概述</h1>

  <h2>1.1 软件简介</h2>
  <p>养房 Tend（baozupo）是一款面向中国大陆个人房东的轻量化租赁管理工具，采用渐进式 Web 应用（PWA）技术开发，可在手机、平板、电脑浏览器多端运行，支持安装到桌面作为独立应用使用。</p>
  <p>本软件以"让管理几套房，像养一盆花一样轻松"为产品理念，整合了房源、租客、租约、账单、收款、抄表、合同管理等房东日常事务的全流程数字化记录，并引入人工智能技术辅助微信、支付宝等支付截图的自动识别录入。</p>

  <h2>1.2 适用人群</h2>
  <ul>
    <li>拥有 1-10 套出租房源的个人房东</li>
    <li>希望摆脱纸笔记账、Excel 表格的中小规模出租户</li>
    <li>多套房源、需要与配偶/子女协作管理的家庭</li>
  </ul>

  <h2>1.3 核心特色</h2>
  <div class="feature-card">
    <strong>1. 全流程闭环：</strong>添加房源 → 录入租客 → 创建租约 → 自动生成账单 → 收款记录 → 历史归档，无需切换多个工具。
  </div>
  <div class="feature-card">
    <strong>2. AI 自动识别：</strong>用户上传微信/支付宝/银行转账截图，由 AI 模型自动识别金额、付款时间、付款方式并填入收款表单。
  </div>
  <div class="feature-card">
    <strong>3. 家庭组协作：</strong>支持多用户共同管理同一组房源，通过 6 位邀请码分享访问权限，数据云端实时同步。
  </div>
  <div class="feature-card">
    <strong>4. 智能提醒：</strong>系统自动生成租金到期、租约到期等关键事件提醒，避免房东遗漏催收。
  </div>
  <div class="feature-card">
    <strong>5. 行级安全（RLS）：</strong>底层数据库通过行级安全策略实现严格的数据隔离，每位用户只能访问自己家庭组的数据。
  </div>
</div>

<!-- ====== 第二章 运行环境 ====== -->
<div class="page">
  <h1>第二章 &nbsp; 运行环境</h1>

  <h2>2.1 软件类型</h2>
  <p>渐进式 Web 应用（Progressive Web App, 简称 PWA），运行于现代浏览器，可通过"添加到主屏幕"安装至手机/桌面，提供与原生应用一致的全屏使用体验。</p>

  <h2>2.2 硬件环境</h2>
  <table>
    <tr><th>类别</th><th>最低配置</th><th>推荐配置</th></tr>
    <tr><td>客户端（手机）</td><td>Android 8 以上 / iOS 14 以上</td><td>Android 12+ / iOS 16+</td></tr>
    <tr><td>客户端（电脑）</td><td>1.5 GHz 双核 CPU / 2 GB 内存</td><td>2.0 GHz 四核 CPU / 4 GB 内存</td></tr>
    <tr><td>网络</td><td>2G/3G 移动数据</td><td>4G/5G/Wi-Fi</td></tr>
  </table>

  <h2>2.3 软件环境</h2>
  <table>
    <tr><th>环节</th><th>技术栈</th></tr>
    <tr><td>前端框架</td><td>Next.js 15 + React 19</td></tr>
    <tr><td>编程语言</td><td>TypeScript 5</td></tr>
    <tr><td>样式系统</td><td>Tailwind CSS 3 + Radix UI</td></tr>
    <tr><td>数据库</td><td>PostgreSQL 15（含行级安全策略 RLS）</td></tr>
    <tr><td>认证服务</td><td>邮箱密码 + JWT 会话</td></tr>
    <tr><td>对象存储</td><td>用于合同文件的 Storage Bucket</td></tr>
    <tr><td>AI 模型</td><td>Anthropic Claude Sonnet（图像识别）</td></tr>
  </table>

  <h2>2.4 兼容浏览器</h2>
  <ul>
    <li>Chrome / Edge 110 及以上</li>
    <li>Safari 16 及以上</li>
    <li>夸克、UC、QQ 浏览器最新版</li>
    <li>微信内置浏览器（仅限只读访问，安装至桌面需在外部浏览器打开）</li>
  </ul>
</div>

<!-- ====== 第三章 功能模块 ====== -->
<div class="page">
  <h1>第三章 &nbsp; 功能模块</h1>

  <h2>3.1 用户登录与注册</h2>
  <p>软件采用邮箱+密码方式注册和登录，密码经服务端哈希加密存储。新用户注册成功后自动创建专属"家庭组"，用于隔离不同用户的数据。</p>
  <h3>主要操作</h3>
  <ul>
    <li>填写邮箱和不少于 6 位的密码，点击"立即注册"完成注册</li>
    <li>已有账号的用户输入相同邮箱密码，点击"登录"</li>
    <li>退出登录可在"设置"页面操作</li>
  </ul>
  <div class="screenshot-row">${imgOrPlaceholder("01-login.png", "登录页")}</div>
</div>

<div class="page">
  <h2>3.2 首页概览</h2>
  <p>首页是软件主入口，按时段动态显示问候语（早安/上午好/下午好/晚上好等），并展示核心运营数据：</p>
  <ul>
    <li><strong>本月应收：</strong>所有进行中租约本月应收金额累计</li>
    <li><strong>已收/待收：</strong>实时收款进度</li>
    <li><strong>逾期账单：</strong>当前逾期未收的账单数量</li>
    <li><strong>出租中房源：</strong>房屋出租状态统计</li>
    <li><strong>即将到期租约：</strong>30 天内即将到期的租约列表</li>
    <li><strong>最近账单：</strong>最近 5 张账单的状态汇总</li>
    <li><strong>待处理提醒：</strong>系统自动生成的智能提醒计数</li>
  </ul>
  <div class="screenshot-row">${imgOrPlaceholder("02-home.png", "首页概览")}</div>
</div>

<div class="page">
  <h2>3.3 房源管理</h2>
  <p>房源是整个软件的核心实体，对应一套实体出租房屋。每个房源可记录如下信息：</p>
  <ul>
    <li><strong>房源名称</strong>（必填，如"朝阳区三里屯A座102"）</li>
    <li><strong>详细地址</strong>（必填）</li>
    <li><strong>省份与城市</strong></li>
    <li><strong>户型</strong>（如"2室1厅1卫"）</li>
    <li><strong>面积</strong>（平方米）</li>
    <li><strong>状态</strong>（出租中 / 空置 / 装修中）</li>
    <li><strong>备注</strong></li>
  </ul>
  <p>点击房源卡片进入详情页，可查看该房源关联的所有租约、抄表记录、账单、合同附件等聚合视图。</p>
  <div class="screenshot-row">${imgOrPlaceholder("03-properties.png", "房源列表")}</div>
  <div class="screenshot-row">${imgOrPlaceholder("04-property-detail.png", "房源详情页")}</div>
</div>

<div class="page">
  <h2>3.4 租客管理</h2>
  <p>租客模块用于记录承租人基本信息，并直接展示该租客当前生效的租约（房源、月租、租期），方便房东快速联系和定位。</p>
  <ul>
    <li><strong>姓名</strong>、<strong>手机号</strong>（必填）</li>
    <li><strong>证件类型</strong>（身份证/护照/驾驶证）和<strong>证件号</strong></li>
    <li><strong>紧急联系人</strong>姓名与电话</li>
    <li><strong>备注</strong></li>
  </ul>
  <p>列表中证件号码以掩码形式显示（仅展示前 6 位和后 4 位），保护租客隐私。</p>
  <div class="screenshot-row">${imgOrPlaceholder("05-tenants.png", "租客管理 — 卡片直接显示当前租约")}</div>
</div>

<div class="page">
  <h2>3.5 租约管理</h2>
  <p>租约是连接房源与租客的核心契约记录，决定了账单的生成方式。</p>
  <h3>租约字段</h3>
  <ul>
    <li>关联房源、主租客（必填）</li>
    <li>起租日期、结束日期</li>
    <li>月租金、押金</li>
    <li>付款周期（月付/季付/半年付/年付）</li>
    <li>收租日（每月几号）</li>
    <li>账单模式（自然月按日历月拆分 / 整月顺延）</li>
  </ul>
  <h3>智能账单生成</h3>
  <p>创建租约时勾选"立即生成全部账单"复选框（默认勾选），系统将根据起租日、结束日和账单模式，自动按月生成全部应收账单。已过期账单标记为"逾期"，未到期标记为"待收"。</p>
  <h3>归档</h3>
  <p>租约结束后可一键归档（设置为已结束状态），关联房源自动改回"空置"。归档采用软删除，数据完整保留以备未来查阅。</p>
  <div class="screenshot-row">${imgOrPlaceholder("06-leases.png", "租约管理")}</div>
</div>

<div class="page">
  <h2>3.6 账单管理</h2>
  <p>账单页统一管理所有租约产生的应收记录，支持按状态过滤：</p>
  <ul>
    <li><strong>全部</strong>：所有账单</li>
    <li><strong>待收</strong>：未到期且未收款</li>
    <li><strong>部分</strong>：部分收款</li>
    <li><strong>逾期</strong>：超过到期日仍未收齐</li>
    <li><strong>已收</strong>：已全额收款</li>
  </ul>
  <p>每张账单卡片显示账期、应收金额、当前状态徽章。点击账单可查看详情或记录新一笔收款。</p>
  <h3>分账逻辑（自然月）</h3>
  <p>例：4 月 15 日起租，月租 5000，4 月按 16/30 日计费 = 2666.67 元，5 月整月 5000，6 月、7 月以此类推。系统自动按比例计算每期金额，日历月切换处由公式精确分摊。</p>
  <div class="screenshot-row">${imgOrPlaceholder("07-bills.png", "账单管理")}</div>
</div>

<div class="page">
  <h2>3.7 AI 收款截图识别（核心特色）</h2>
  <p>这是本软件区别于传统记账工具的关键功能。当房东需要记录一笔收款时：</p>
  <ol>
    <li>在收款表单点击"上传付款截图，AI 自动识别"区域</li>
    <li>选择手机相册中的微信/支付宝/银行转账截图</li>
    <li>系统将截图通过 HTTPS 加密发送至 AI 服务（Anthropic Claude Sonnet 多模态模型）</li>
    <li>AI 模型识别图像中的：
      <ul>
        <li>付款金额</li>
        <li>付款时间（精确到分钟）</li>
        <li>付款方姓名（脱敏部分保留）</li>
        <li>收款方姓名</li>
        <li>支付方式（微信/支付宝/银行/现金）</li>
        <li>识别置信度</li>
      </ul>
    </li>
    <li>识别结果自动填入表单各字段，房东核对后点击"确认收款"完成</li>
  </ol>
  <p>此功能在<code>src/app/api/ai/recognize-payment/route.ts</code>中实现，包含图片大小校验（5MB 以内）、MIME 类型检查（仅 JPEG/PNG/WebP/GIF）、错误回退等保护机制。</p>
  <div class="screenshot-row">${imgOrPlaceholder("08-ai-recognize.png", "AI 截图识别 — 收款表单")}</div>
</div>

<div class="page">
  <h2>3.8 抄表记录</h2>
  <p>支持电、水、燃气三种类型的读数记录与用量计算。</p>
  <ul>
    <li>选择关联房源、读数日期</li>
    <li>录入本次读数（单位：度/吨/方）</li>
    <li>系统自动取该房源该类型上次读数，计算<strong>用量 = 本次 - 上次</strong></li>
    <li>可设置单价（元/度），自动计算金额</li>
  </ul>
  <p>抄表记录可作为水电费转账给租客的核算凭证，也可作为日后水电费计入账单的数据来源。</p>
  <div class="screenshot-row">${imgOrPlaceholder("09-meters.png", "抄表记录")}</div>
</div>

<div class="page">
  <h2>3.9 提醒中心</h2>
  <p>系统每天自动扫描数据并生成关键事件提醒，避免房东遗漏：</p>
  <ul>
    <li><strong>租金到期提醒：</strong>账单到期前 N 天提醒催收</li>
    <li><strong>租约到期提醒：</strong>租约结束前 30 天提醒续签</li>
    <li><strong>抄表周期提醒：</strong>定期提醒上门抄表</li>
    <li><strong>自定义提醒：</strong>用户可手动添加</li>
  </ul>
  <p>所有未处理的提醒会在首页顶部以 Bell 图标 + 数字徽章形式聚合展示，点击进入详情页可单条标记已处理或一键忽略。</p>
  <div class="screenshot-row">${imgOrPlaceholder("10-reminders.png", "提醒中心")}</div>
</div>

<div class="page">
  <h2>3.10 家庭组协作</h2>
  <p>每位用户注册时自动创建一个"家庭组"作为数据隔离单元。家庭组所有者可以邀请家人共同管理：</p>
  <ol>
    <li>所有者点击"生成邀请码"，系统创建一个 6 位字母数字组合（避开易混淆字符 0/O/1/I 等）</li>
    <li>邀请码 24 小时内有效，仅可使用一次</li>
    <li>受邀人在他的设备上点击"加入家庭组"，输入邀请码即可</li>
    <li>家庭组所有成员共享房源、租客、租约、账单等所有数据</li>
  </ol>
  <p>底层通过 PostgreSQL 行级安全策略（RLS）实现：每个数据表的查询会自动加入"household_id 必须属于当前用户所属家庭组"的限制条件，从数据库层面保证跨家庭组无法越权访问。</p>
  <div class="screenshot-row">${imgOrPlaceholder("11-household.png", "家庭组")}</div>
</div>

<!-- ====== 第四章 系统架构 ====== -->
<div class="page">
  <h1>第四章 &nbsp; 系统架构</h1>

  <h2>4.1 总体架构</h2>
  <p>本软件采用前后端分离的三层架构：</p>
  <ul>
    <li><strong>前端层：</strong>Next.js + React 构建的单页应用，通过 PWA 技术实现"添加到桌面"独立安装</li>
    <li><strong>API 层：</strong>Next.js API Routes 处理服务端逻辑，包含 AI 截图识别接口</li>
    <li><strong>数据层：</strong>PostgreSQL 数据库 + 对象存储 Bucket，支持行级安全策略</li>
  </ul>

  <h2>4.2 数据模型（13 张核心表）</h2>
  <table>
    <tr><th>表名</th><th>用途</th></tr>
    <tr><td>households</td><td>家庭组（数据隔离单元）</td></tr>
    <tr><td>household_members</td><td>家庭组成员关系</td></tr>
    <tr><td>household_invites</td><td>邀请码记录（24 小时有效）</td></tr>
    <tr><td>user_profiles</td><td>用户资料</td></tr>
    <tr><td>properties</td><td>房源</td></tr>
    <tr><td>tenants</td><td>租客</td></tr>
    <tr><td>leases</td><td>租约</td></tr>
    <tr><td>lease_tenants</td><td>租约与租客多对多关系</td></tr>
    <tr><td>bills</td><td>账单</td></tr>
    <tr><td>payments</td><td>收款记录</td></tr>
    <tr><td>meter_readings</td><td>抄表记录</td></tr>
    <tr><td>reminders</td><td>提醒</td></tr>
    <tr><td>attachments</td><td>附件（合同、截图等）</td></tr>
  </table>

  <h2>4.3 核心算法</h2>
  <p><strong>账单生成算法</strong>（src/lib/billing.ts）：根据起租日、结束日、月租、收租日和账单模式（自然月/整月顺延），按规则切片生成多期账单，自动处理跨月分摊和最末月零头。</p>
  <p><strong>抄表算法</strong>（src/lib/meter-billing.ts）：对每个房源每种类型自动取最近一次读数作为"上次读数"，本次读数 - 上次读数 = 本期用量，用量 × 单价 = 本期金额。</p>
  <p><strong>提醒算法</strong>（src/lib/reminders.ts）：每次首页加载时调用 ensureReminders 服务，根据账单到期、租约到期、抄表间隔等规则生成新提醒，同一事件不重复生成。</p>

  <h2>4.4 安全机制</h2>
  <ul>
    <li>密码采用 bcrypt 哈希存储</li>
    <li>会话基于 JWT，HttpOnly Cookie 防 XSS</li>
    <li>所有业务数据查询都被 PostgreSQL 行级安全策略强制约束</li>
    <li>HTTPS 全程加密传输</li>
    <li>对象存储按家庭组前缀隔离，跨家庭组无法访问对方文件</li>
  </ul>

  <p style="margin-top:20mm;text-align:center;color:#999;font-size:10pt;">— 完 —</p>
</div>

</body>
</html>
`;

writeFileSync(join(OUT_DIR, "软件操作手册-V1.0.html"), html);
console.log("✅ 软件操作手册已生成: 软著申请材料/软件操作手册-V1.0.html");
console.log("   用浏览器打开 → Ctrl+P → 保存为 PDF 即可");
console.log("   截图替换：在 软著申请材料/screenshots/ 放 01-login.png ~ 11-household.png 即可自动嵌入");
