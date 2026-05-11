import { writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REAL_DIR = "K:\\养房\\软著申请材料";
const OUT_DIR = process.env.SOFT_COPYRIGHT_DIR
  || (existsSync(REAL_DIR) ? REAL_DIR : join(__dirname, "..", "软著申请材料"));

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>软著申请傻瓜式指南 - 养房 Tend</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Microsoft YaHei", "苹方", sans-serif; font-size: 11pt; line-height: 1.7; color: #222; max-width: 800px; margin: 0 auto; padding: 20mm; background: white; }
  h1 { font-size: 22pt; color: #C8553D; margin: 0 0 6mm 0; padding-bottom: 4mm; border-bottom: 2px solid #C8553D; }
  h2 { font-size: 16pt; color: #C8553D; margin: 8mm 0 3mm 0; padding-left: 8px; border-left: 4px solid #C8553D; }
  h3 { font-size: 13pt; color: #444; margin: 6mm 0 2mm 0; }
  p, li { font-size: 11pt; }
  ol, ul { padding-left: 6mm; }
  li { margin-bottom: 2mm; }
  .step { background: #FBEEE9; border-left: 3px solid #C8553D; padding: 4mm 5mm; margin-bottom: 4mm; border-radius: 4px; }
  .warn { background: #FFF8E5; border: 1px solid #F0C36D; padding: 3mm 5mm; margin: 4mm 0; border-radius: 4px; color: #8a6d3b; }
  .ok { background: #E8F5E9; border: 1px solid #81C784; padding: 3mm 5mm; margin: 4mm 0; border-radius: 4px; color: #2E7D32; }
  table { width: 100%; border-collapse: collapse; margin: 3mm 0; font-size: 10.5pt; }
  th, td { border: 1px solid #ddd; padding: 3mm; text-align: left; }
  th { background: #FBEEE9; color: #C8553D; }
  code { background: #f5f5f5; padding: 1px 5px; border-radius: 3px; font-family: Consolas, monospace; }
  .field { display: grid; grid-template-columns: 180px 1fr; gap: 3mm; margin-bottom: 2mm; padding: 2mm 0; border-bottom: 1px dotted #ddd; }
  .field-name { font-weight: 600; color: #555; }
  .field-value { color: #C8553D; }
  .checkbox { display: inline-block; width: 16px; height: 16px; border: 1.5px solid #999; border-radius: 3px; margin-right: 4px; vertical-align: middle; }
</style>
</head>
<body>

<h1>养房 Tend 软著申请傻瓜式指南</h1>
<p>跟着每一步操作，30 个工作日后下证。著作权人为 <strong>深圳市一铠科技有限公司</strong>。</p>

<div class="warn">
<strong>⚠ 阅读顺序：</strong>本文档分 <code>第 1 步</code> 到 <code>第 7 步</code>，请按顺序操作。每完成一步在前面的方框里打勾。
</div>

<h2>📦 申请材料清单（你已有/我已生成）</h2>
<ul>
  <li><span class="checkbox"></span> <strong>营业执照副本扫描件</strong>（彩色扫描或拍照，要清晰，所有字段可读）</li>
  <li><span class="checkbox"></span> <strong>公司公章 PDF / 扫描件</strong>（盖在白纸上拍清晰）</li>
  <li><span class="checkbox"></span> <strong>法人身份证正反面扫描件</strong>（部分流程会要求，备用）</li>
  <li><span class="checkbox"></span> <strong>源代码 - 前 30 页</strong>（已生成：<code>源代码-前30页.html</code>，需打印为 PDF）</li>
  <li><span class="checkbox"></span> <strong>源代码 - 后 30 页</strong>（已生成：<code>源代码-后30页.html</code>，需打印为 PDF）</li>
  <li><span class="checkbox"></span> <strong>软件操作手册</strong>（已生成：<code>软件操作手册-V1.0.html</code>，需打印为 PDF）</li>
  <li><span class="checkbox"></span> <strong>软件截图（11 张）</strong>（你来截图，命名 <code>01-login.png</code> ~ <code>11-household.png</code>，放到 <code>软著申请材料/screenshots/</code> 文件夹，再重新跑生成命令把图嵌入）</li>
</ul>

<div class="ok">
<strong>✓ 我帮你做好的：</strong>所有源代码、操作手册、字段建议值（已按公司主体填）。<br/>
<strong>● 需要你做的：</strong>截图、打印 PDF、注册单位账号、上传公司材料、提交申请、付款（如要加急）。
</div>

<h2>🖼 第 1 步：截图（30 分钟）</h2>
<p>用手机或电脑访问 <code>baozupo.vercel.app</code>，登录后挨个页面截图。命名规范：</p>
<table>
  <tr><th>截图编号</th><th>页面</th><th>怎么截</th></tr>
  <tr><td>01-login.png</td><td>登录页</td><td>退出登录后截</td></tr>
  <tr><td>02-home.png</td><td>首页</td><td>登录后默认页面</td></tr>
  <tr><td>03-properties.png</td><td>房源列表</td><td>底部导航点"房源"</td></tr>
  <tr><td>04-property-detail.png</td><td>房源详情</td><td>列表里点任一卡片</td></tr>
  <tr><td>05-tenants.png</td><td>租客列表</td><td>底部导航点"租客"</td></tr>
  <tr><td>06-leases.png</td><td>租约管理</td><td>"更多" → "租约管理"</td></tr>
  <tr><td>07-bills.png</td><td>账单页</td><td>底部导航点"账单"</td></tr>
  <tr><td>08-ai-recognize.png</td><td>收款表单（AI 区域可见）</td><td>账单页点"标记已收"，截带"上传付款截图"提示的画面</td></tr>
  <tr><td>09-meters.png</td><td>抄表记录</td><td>"更多" → "抄表记录"</td></tr>
  <tr><td>10-reminders.png</td><td>提醒中心</td><td>首页提醒卡片点进去</td></tr>
  <tr><td>11-household.png</td><td>家庭组</td><td>桌面端侧栏点"家庭组"</td></tr>
</table>
<p>把这 11 张图统一放到 <code>K:\\baozupo\\软著申请材料\\screenshots\\</code> 目录，然后**告诉我"截图都放好了"**，我重新跑一次生成命令，截图就自动嵌入操作手册里了。</p>

<h2>📄 第 2 步：把 HTML 打印成 PDF（10 分钟）</h2>
<p>软著申请要求 PDF 格式，所以三个 HTML 都要打印成 PDF：</p>
<ol>
  <li>在文件管理器双击 <code>软件操作手册-V1.0.html</code>，浏览器会打开</li>
  <li>按 <code>Ctrl+P</code> 调出打印对话框</li>
  <li>"目标"选择"<strong>另存为 PDF</strong>"</li>
  <li>"页面"选"<strong>全部</strong>"</li>
  <li>"边距"选"<strong>无</strong>"或"<strong>默认</strong>"</li>
  <li>"选项"勾选"<strong>背景图形</strong>"（这样品牌色才能保留）</li>
  <li>点"<strong>保存</strong>"，文件名为 <code>软件操作手册-V1.0.pdf</code></li>
  <li>同样方式处理 <code>源代码-前30页.html</code> → <code>源代码-前30页.pdf</code></li>
  <li>同样方式处理 <code>源代码-后30页.html</code> → <code>源代码-后30页.pdf</code></li>
</ol>

<h2>🌐 第 3 步：注册中国版权保护中心账号（10 分钟）</h2>
<div class="step">
<strong>访问网址：</strong><code>https://register.ccopyright.com.cn/registerIndex.html</code>
</div>
<ol>
  <li>点首页右上角"<strong>注册</strong>"</li>
  <li>选择"<strong>单位用户</strong>"（不要选"自然人用户"，否则著作权人会变成个人）</li>
  <li>填写公司邮箱、法人或经办人手机、密码（密码记下来，下证后还要登录查询）</li>
  <li>邮箱验证 + 手机验证</li>
  <li>登录后进入单位中心，提交<strong>单位实名认证</strong>，上传：
    <ul>
      <li><strong>营业执照副本彩色扫描件</strong>（PDF 或图片，清晰可读）</li>
      <li><strong>经办人身份证正反面</strong>（一般填法人）</li>
      <li><strong>授权委托书</strong>（如果经办人不是法人，需要法人手写签名 + 加盖公章；如经办人就是法人，可跳过）</li>
    </ul>
  </li>
  <li>填写单位基本信息：
    <div class="field"><div class="field-name">单位名称</div><div class="field-value">深圳市一铠科技有限公司</div></div>
    <div class="field"><div class="field-name">统一社会信用代码</div><div class="field-value">91440300MADJDXM09R</div></div>
    <div class="field"><div class="field-name">单位性质</div><div class="field-value">有限责任公司</div></div>
    <div class="field"><div class="field-name">注册地址</div><div class="field-value">营业执照上的地址原文</div></div>
    <div class="field"><div class="field-name">法定代表人</div><div class="field-value">营业执照上的法人姓名</div></div>
  </li>
  <li>等待 <strong>3-5 个工作日</strong>单位认证通过（单位比个人慢一些）</li>
</ol>

<div class="warn">
<strong>💡 小贴士：</strong>单位账号一次申请通过后，未来公司的所有软件软著都用这个账号，不用重新申请。多版本 (V2.0/V3.0) 都在这下面继续递交。
</div>

<h2>📝 第 4 步：在线填写软著申请表（30 分钟）</h2>
<p>认证通过后，进入"<strong>计算机软件著作权登记</strong>"模块，新建申请。每一项填这个：</p>

<h3>4.1 软件基本信息</h3>
<div class="field"><div class="field-name">软件名称（全称）</div><div class="field-value">养房 Tend</div></div>
<div class="field"><div class="field-name">软件名称（简称）</div><div class="field-value">养房</div></div>
<div class="field"><div class="field-name">版本号</div><div class="field-value">V1.0</div></div>
<div class="field"><div class="field-name">开发完成日期</div><div class="field-value">写今天的日期</div></div>
<div class="field"><div class="field-name">首次发表日期</div><div class="field-value">是否发表 选"未发表"（推荐，防止抢注）</div></div>
<div class="field"><div class="field-name">软件分类</div><div class="field-value">应用软件 → 房地产 / 财务管理</div></div>
<div class="field"><div class="field-name">权利取得方式</div><div class="field-value">原始取得</div></div>
<div class="field"><div class="field-name">权利范围</div><div class="field-value">全部权利</div></div>

<h3>4.2 著作权人信息（单位）</h3>
<div class="field"><div class="field-name">著作权人类型</div><div class="field-value">法人或其他组织</div></div>
<div class="field"><div class="field-name">单位名称（全称）</div><div class="field-value">深圳市一铠科技有限公司</div></div>
<div class="field"><div class="field-name">证件类型</div><div class="field-value">统一社会信用代码证</div></div>
<div class="field"><div class="field-name">证件号码</div><div class="field-value">91440300MADJDXM09R</div></div>
<div class="field"><div class="field-name">单位性质</div><div class="field-value">有限责任公司</div></div>
<div class="field"><div class="field-name">所属行业</div><div class="field-value">信息传输、软件和信息技术服务业</div></div>
<div class="field"><div class="field-name">法定代表人</div><div class="field-value">营业执照上的法人姓名</div></div>
<div class="field"><div class="field-name">联系电话</div><div class="field-value">法人或经办人手机</div></div>
<div class="field"><div class="field-name">邮箱</div><div class="field-value">注册账号用的公司邮箱</div></div>
<div class="field"><div class="field-name">通讯地址</div><div class="field-value">营业执照注册地址原文</div></div>
<div class="field"><div class="field-name">邮政编码</div><div class="field-value">注册地址对应邮编（深圳 518000 起，按区填）</div></div>

<h3>4.3 开发者信息</h3>
<p>"开发者"指实际写代码的主体。本项目由公司自有团队开发，所以著作权人 = 开发者，<strong>勾选"著作权人即开发者"</strong>即可，不用重复填。</p>

<h3>4.4 软件功能描述（让我直接写好你抄）</h3>
<div class="step">
养房 Tend 是深圳市一铠科技有限公司自主研发的一款面向中国大陆个人房东的轻量化租赁管理软件，采用渐进式 Web 应用（PWA）技术开发。核心功能包括：房源信息管理、租客信息管理、租约创建与归档、自动账单生成与状态追踪、收款记录、AI 自动识别微信/支付宝/银行转账截图、水电气抄表、智能提醒、合同附件管理、家庭组多人协作。软件采用前后端分离架构，前端基于 Next.js 与 React，后端基于 PostgreSQL 数据库与行级安全策略，AI 功能由多模态视觉理解大模型提供，支持移动端 / 桌面端多终端访问。
</div>

<h3>4.5 技术信息</h3>
<div class="field"><div class="field-name">编程语言</div><div class="field-value">TypeScript（基于 JavaScript）</div></div>
<div class="field"><div class="field-name">硬件平台</div><div class="field-value">智能手机 + 个人电脑</div></div>
<div class="field"><div class="field-name">操作系统</div><div class="field-value">Android、iOS、Windows、macOS</div></div>
<div class="field"><div class="field-name">代码总行数</div><div class="field-value">约 9700 行（详见 代码统计.txt）</div></div>

<h2>📤 第 5 步：上传材料（10 分钟）</h2>
<p>系统会让你上传 PDF 文件，按提示对应上传：</p>
<table>
  <tr><th>系统要求</th><th>对应你的文件</th></tr>
  <tr><td>源程序（前 30 + 后 30 页）</td><td><code>源代码-前30页.pdf</code> + <code>源代码-后30页.pdf</code>（合并为一份或分别上传）</td></tr>
  <tr><td>软件文档（操作手册）</td><td><code>软件操作手册-V1.0.pdf</code></td></tr>
  <tr><td>主体证明文件</td><td><strong>营业执照副本彩色扫描件</strong>（PDF）</td></tr>
  <tr><td>授权委托书（如适用）</td><td>经办人非法人时需要：法人手写签名 + 公司公章扫描件</td></tr>
</table>

<div class="warn">
<strong>📌 公司主体特有要求：</strong>所有上传的 PDF / 图片 <strong>必须在右下角加盖公司公章</strong>（电子盖章或纸质盖章后扫描都行）。如果你不会做电子盖章，告诉我，我用 Python 帮你把公章 PNG 自动盖到 PDF 右下角。
</div>

<h2>💰 第 6 步：缴费 / 加急选择</h2>
<table>
  <tr><th>方式</th><th>下证时间</th><th>费用</th><th>建议</th></tr>
  <tr><td>普通办理</td><td>30-45 个工作日</td><td><strong>免费</strong></td><td>✅ 推荐（你不急于上市场就选这个）</td></tr>
  <tr><td>31 工作日加急</td><td>31 个工作日</td><td>¥600</td><td>没必要</td></tr>
  <tr><td>10 工作日加急</td><td>10 个工作日</td><td>¥3000</td><td>非要快上线才考虑</td></tr>
  <tr><td>3 工作日加急</td><td>3 个工作日</td><td>¥6000</td><td>不推荐</td></tr>
</table>

<h2>⏳ 第 7 步：等待 + 跟进</h2>
<ul>
  <li>提交后 1-2 周内系统会发邮件 / 短信告知"<strong>受理通知书</strong>"已下，可以在个人中心下载</li>
  <li>之后进入实质审查阶段，期间可能会让你<strong>补正材料</strong>（比如要求换截图、要求改某个字段）— 收到补正通知 30 天内必须回复</li>
  <li>审查通过后系统会通知你"<strong>登记证书</strong>"已下，**电子证书**可在线下载，**纸质证书**邮寄到<strong>公司注册地址</strong>（或自己去窗口取）</li>
  <li>下证后 → 公司就持有正式的"<strong>计算机软件著作权登记证书</strong>" → 可以拿去华为、应用宝等需要软著的应用市场上架了，未来融资 / 估值时也是公司无形资产</li>
</ul>

<div class="ok">
<strong>✓ 流程结束。</strong> 软著的事不需要再操心，等通知就行。期间我们正常做其他事（迁移、Capacitor 重打包等）。
</div>

<h2>❓ 常见问题</h2>

<h3>Q：填错了能改吗？</h3>
<p>提交前都能改。提交后只能等"补正通知"才能改特定字段。所以提交前**仔细检查一遍每个字段**。</p>

<h3>Q：源代码会被泄漏吗？</h3>
<p>不会。版权保护中心的审核员只看，不流出。源代码 PDF 不会被公开。</p>

<h3>Q：软件名称要不要改？</h3>
<p>"养房 Tend" 这个名字 = 中文 + 英文混合，按规则要看版权中心是否接受。如果他们要求纯中文，备用名建议：<strong>养房助手</strong>、<strong>房东 Tend</strong>。等他们让补正再说，先按 "养房 Tend" 提交。</p>

<h3>Q：要找代理公司吗？</h3>
<p>公司自己完全能办。代理公司收 ¥500-1500 帮你填表 + 跟进，但你看了这份指南其实经办人 30 分钟就能搞定。如果走加急通道（¥3000+），代理可能更熟悉流程。</p>

<h3>Q：以公司名义申请有什么好处？</h3>
<ul>
  <li><strong>风险隔离</strong>：未来软件如有用户纠纷、知识产权诉讼，由公司承担，不波及法人个人财产</li>
  <li><strong>无形资产</strong>：软著证书可作为公司无形资产入账，融资 / 估值 / 高新技术企业认定都用得上</li>
  <li><strong>应用市场</strong>：华为 / 应用宝等市场上架要求"软著主体 = 开发者账号主体"，公司一致更顺</li>
  <li><strong>多版本统一</strong>：未来 V2.0、V3.0、V4.0 都在同一公司账号下，集中管理</li>
</ul>

<h3>Q：公司公章怎么电子化盖到 PDF 上？</h3>
<p>三种方法（按推荐顺序）：</p>
<ol>
  <li><strong>WPS / Microsoft Word</strong>：插入 → 图片 → 选公章 PNG → 设置文字环绕"浮于文字上方" → 拖到右下角 → 另存为 PDF</li>
  <li><strong>Adobe Acrobat</strong>：工具 → 标记和注释 → 添加图章 → 自定义图章 → 导入公章 PNG</li>
  <li>告诉我"帮我盖章"，我用 Python 自动批量盖章到所有 PDF 右下角</li>
</ol>

<h3>Q：申请费用全公司账户出吗？</h3>
<p>建议是。普通办理免费；加急走对公支付（开发票方便）。如个人代付要走"借款 / 报销"流程，麻烦。</p>

<p style="text-align:center;color:#888;margin-top:20mm;">— 完 —</p>

</body>
</html>
`;

writeFileSync(join(OUT_DIR, "软著申请傻瓜式指南.html"), html);
console.log("✅ 软著申请指南已生成: 软著申请材料/软著申请傻瓜式指南.html");
