/* eslint-disable react/no-unescaped-entities */
import Link from "next/link";

export const metadata = {
  title: "隐私政策 - 养房 Tend",
};

const UPDATED_AT = "2026 年 5 月 11 日";
const EFFECTIVE_AT = "2026 年 5 月 11 日";

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-[#FBEEE9]/30">
      <div className="max-w-3xl mx-auto px-4 md:px-8 py-6 md:py-10">
        <article className="bg-white rounded-2xl shadow-sm p-6 md:p-10 prose prose-sm md:prose-base max-w-none">
          <h1 className="text-2xl md:text-3xl font-bold text-[#C8553D] mb-2">养房 Tend 隐私政策</h1>
          <p className="text-sm text-muted-foreground mb-6">
            更新日期：{UPDATED_AT} ｜ 生效日期：{EFFECTIVE_AT}
          </p>

          <div className="bg-[#FBEEE9] border-l-4 border-[#C8553D] rounded-r-lg p-4 mb-8 text-[14px] leading-7">
            <strong>本政策摘要：</strong>
            <ul className="mt-2 mb-0 list-disc pl-5 space-y-1">
              <li>我们只收集为您提供服务所必需的最少信息</li>
              <li>您的房源、租客、账单等业务数据归您所有</li>
              <li>未经您同意，我们不会向任何第三方出售或分享您的个人信息</li>
              <li>您随时可以查询、修改、删除自己的数据，或注销账号</li>
              <li>数据存储于中华人民共和国境内的合规云服务（阿里云）</li>
            </ul>
          </div>

          <Section title="一、引言">
            <p>
              <strong>深圳市一铠科技有限公司</strong>（以下简称"我们"或"公司"）
              依据《中华人民共和国个人信息保护法》《中华人民共和国数据安全法》《中华人民共和国网络安全法》
              及相关法律法规，制订本《隐私政策》。
            </p>
            <p>
              本政策适用于您通过 Web 站点（baozupo.vercel.app 及未来正式域名）、PWA、Android APK、
              iOS、微信公众号、微信小程序等任何渠道使用养房 Tend 服务（以下简称"本服务"）的全过程。
            </p>
            <p>
              <strong>请您在使用本服务前仔细阅读本政策，特别是加粗内容。</strong>一旦您开始使用，
              即视为您已充分理解并接受本政策。
            </p>
          </Section>

          <Section title="二、我们收集哪些信息">
            <h3 className="text-base font-semibold mt-4 mb-2">2.1 您主动提供的信息</h3>
            <table className="w-full text-sm border-collapse my-3">
              <thead>
                <tr className="bg-[#FBEEE9]">
                  <th className="border p-2 text-left">信息类型</th>
                  <th className="border p-2 text-left">具体内容</th>
                  <th className="border p-2 text-left">用途</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="border p-2">账号信息</td>
                  <td className="border p-2">邮箱、手机号、密码（加密存储）</td>
                  <td className="border p-2">用户身份认证、找回密码</td>
                </tr>
                <tr>
                  <td className="border p-2">个人资料</td>
                  <td className="border p-2">称呼、头像（可选）</td>
                  <td className="border p-2">个性化展示</td>
                </tr>
                <tr>
                  <td className="border p-2">业务数据</td>
                  <td className="border p-2">房源地址、租客姓名/电话、租约金额、账单明细</td>
                  <td className="border p-2">为您提供租赁管理功能</td>
                </tr>
                <tr>
                  <td className="border p-2">图片附件</td>
                  <td className="border p-2">合同扫描件、收款截图、抄表照片</td>
                  <td className="border p-2">归档查阅、AI 识别</td>
                </tr>
                <tr>
                  <td className="border p-2">微信信息</td>
                  <td className="border p-2">绑定公众号/小程序后的 OpenID、昵称</td>
                  <td className="border p-2">发送提醒、订阅消息</td>
                </tr>
                <tr>
                  <td className="border p-2">支付信息</td>
                  <td className="border p-2">订单号、支付金额、支付时间（不接触银行卡号）</td>
                  <td className="border p-2">订阅 Pro 服务、对账</td>
                </tr>
              </tbody>
            </table>

            <h3 className="text-base font-semibold mt-6 mb-2">2.2 我们自动收集的信息</h3>
            <ul>
              <li>
                <strong>设备与日志信息：</strong>设备型号、操作系统版本、浏览器版本、IP 地址、
                访问时间、操作日志。用于保障系统安全、定位 bug。
              </li>
              <li>
                <strong>Cookie 与本地存储：</strong>用于保持登录状态、记录偏好设置。
                您可在浏览器设置中关闭，但部分功能可能无法使用。
              </li>
            </ul>

            <h3 className="text-base font-semibold mt-6 mb-2">2.3 我们不会收集的敏感信息</h3>
            <p>
              我们<strong>不会主动收集</strong>您或租客的身份证号、银行卡密码、人脸信息、生物识别信息、
              精确地理位置（如 GPS 坐标）、健康医疗信息等敏感个人信息。
              如您主动在合同附件中上传含有上述内容的图片，我们仅做加密存储，
              <strong>不做识别、不做分析、不与任何第三方共享</strong>。
            </p>
          </Section>

          <Section title="三、我们如何使用这些信息">
            <ul>
              <li><strong>核心功能：</strong>实现房源/租客/账单/抄表/提醒等管理功能</li>
              <li><strong>AI 智能识别：</strong>将您上传的收款截图、抄表照片传输至 AI 模型识别，
                识别结果返回您本人查看，<strong>不用于其他用途，不存为训练数据</strong></li>
              <li><strong>账户安全：</strong>登录验证、异常登录检测、防止账号被盗</li>
              <li><strong>客户服务：</strong>响应您的咨询、投诉、申诉</li>
              <li><strong>产品优化：</strong>对去标识化的统计数据进行分析（如功能使用率、错误率），优化产品</li>
              <li><strong>合规所需：</strong>履行法律法规规定的备案、配合执法的义务</li>
            </ul>
          </Section>

          <Section title="四、AI 识别服务的特别说明">
            <p>
              本服务的 AI 收款识别、AI 抄表识别功能，由以下大模型服务提供商提供能力：
            </p>
            <ul>
              <li><strong>阿里云通义千问</strong>（阿里云计算有限公司，主用模型，境内合规）</li>
              <li><strong>Anthropic Claude</strong>（备用模型，仅在境外环境下使用）</li>
            </ul>
            <p>
              当您使用 AI 识别功能时：
            </p>
            <ul>
              <li>您上传的图片会临时传输至上述服务商进行识别，识别完成后立即返回结构化结果</li>
              <li>我们与服务商签有数据处理协议，约定<strong>不得将您的数据用于模型训练</strong></li>
              <li>识别完成后图片不会在服务商侧长期保留（保留时长视服务商协议，通常 ≤ 30 天）</li>
              <li>识别结果（如金额、日期、表数）保存在您账号的数据库中，归您所有</li>
            </ul>
            <p>
              <strong>您始终可以选择不使用 AI 识别功能</strong>，手动录入数据即可。
            </p>
          </Section>

          <Section title="五、信息的存储与保护">
            <h3 className="text-base font-semibold mt-4 mb-2">5.1 存储位置</h3>
            <p>
              在 ICP 备案完成并迁移至阿里云之前，您的数据暂存于 Supabase 国际版（位于美国）。
              <strong>预计 2026 年内完成迁移</strong>，届时所有数据将转移至阿里云中国大陆华南/华东节点，
              并在阿里云对象存储（OSS）中加密保留备份。
            </p>
            <h3 className="text-base font-semibold mt-4 mb-2">5.2 存储期限</h3>
            <ul>
              <li>账号信息：账号存续期间持续保留，注销后 30 日内删除</li>
              <li>业务数据：账号存续期间持续保留，注销后 30 日内删除</li>
              <li>支付订单：依据《电子商务法》《税收征管法》保留 5 年</li>
              <li>日志数据：6 个月后自动清除</li>
            </ul>
            <h3 className="text-base font-semibold mt-4 mb-2">5.3 安全措施</h3>
            <ul>
              <li>传输：全程 HTTPS / TLS 1.2+ 加密</li>
              <li>存储：数据库行级安全（RLS）+ 字段加密</li>
              <li>访问：员工最小权限原则 + 双因素认证</li>
              <li>备份：每日自动备份至阿里云 OSS，保留 30 日</li>
              <li>审计：所有数据库操作留有审计日志</li>
            </ul>
          </Section>

          <Section title="六、我们如何共享您的信息">
            <p>
              <strong>除以下情形外，我们不会向任何第三方共享您的个人信息：</strong>
            </p>
            <ul>
              <li>
                <strong>获得您的明示同意</strong>后向特定第三方提供
              </li>
              <li>
                <strong>履行服务所必需</strong>：如使用阿里云作为云服务商、调用 AI 模型 API、
                通过微信支付 / 支付宝完成订阅扣款，此类合作方仅在为您完成服务的必要范围内处理数据
              </li>
              <li>
                <strong>法律法规要求</strong>：配合公安机关、监管机构、法院调查取证
              </li>
              <li>
                <strong>保护公司或他人权益</strong>：制止欺诈、违法、严重违反协议等行为
              </li>
              <li>
                <strong>去标识化的统计数据</strong>：可能用于行业报告、产品宣传，但<strong>不包含可识别您身份的信息</strong>
              </li>
            </ul>
            <p>
              所有合作方均签订严格的数据保密协议，违反者由我们追究法律责任。
            </p>
          </Section>

          <Section title="七、您的权利">
            <p>根据法律法规，您对自己的个人信息享有以下权利：</p>
            <ul>
              <li><strong>查询权：</strong>查看账号下的全部数据（可通过应用内"设置 → 我的数据"）</li>
              <li><strong>更正权：</strong>修改错误或过时的信息</li>
              <li><strong>删除权：</strong>删除个别数据，或注销账号删除全部数据</li>
              <li><strong>复制权：</strong>导出 Excel / CSV 格式的数据副本</li>
              <li><strong>撤回同意权：</strong>撤回此前对某项处理的授权（如停用 AI 识别）</li>
              <li><strong>反对权：</strong>反对将您的数据用于自动化决策或精准营销</li>
            </ul>
            <p>
              如需行使上述权利，请通过<strong>设置页内的对应操作</strong>，
              或发送邮件至 <code>support@yikai.tech</code>（暂用占位，待启用后更新）。
              我们将在收到请求后 15 日内响应。
            </p>
          </Section>

          <Section title="八、未成年人保护">
            <p>
              本服务<strong>不面向未满 18 周岁</strong>的未成年人提供。若您是未成年人，请在监护人陪同下使用，
              否则您和监护人需承担相应责任。如我们发现您未满 18 周岁，将在合理时间内删除相关账号及数据。
            </p>
          </Section>

          <Section title="九、Cookie 与同类技术">
            <p>
              我们使用 Cookie、LocalStorage 等技术存储登录状态、记录偏好设置、统计访问数据。
              您可在浏览器设置中清除或禁用，但禁用后部分功能将无法正常使用。
            </p>
          </Section>

          <Section title="十、政策的变更">
            <p>
              本政策可能因法律法规变化、产品升级而修订。重大变更（如收集范围扩大、共享对象增加）
              将通过应用内弹窗、邮件、推送等显著方式提前 7 日通知您；常规修订将在本页面更新生效日期，
              不再单独通知。请定期查阅本政策。
            </p>
          </Section>

          <Section title="十一、联系我们">
            <ul>
              <li>个人信息保护负责人邮箱：<code>privacy@yikai.tech</code>（暂用占位）</li>
              <li>客服邮箱：<code>support@yikai.tech</code>（暂用占位）</li>
              <li>公司名称：深圳市一铠科技有限公司</li>
              <li>统一社会信用代码：91440300MADJDXM09R</li>
              <li>邮寄地址：以营业执照注册地址为准</li>
            </ul>
            <p className="mt-4">
              如您对我们的回复不满意，可向网信办、工信部等监管部门投诉，或向公司注册地（深圳市）人民法院提起诉讼。
            </p>
          </Section>

          <p className="text-sm text-muted-foreground mt-10 pt-6 border-t">
            您可同时查阅 <Link href="/terms" className="text-[#C8553D] underline">《用户服务协议》</Link>。
            本政策的最终解释权归深圳市一铠科技有限公司所有。
          </p>
        </article>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="text-lg md:text-xl font-semibold text-[#C8553D] mb-3">{title}</h2>
      <div className="text-[15px] leading-7 text-foreground/90 space-y-3">{children}</div>
    </section>
  );
}
