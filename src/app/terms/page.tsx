/* eslint-disable react/no-unescaped-entities */
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export const metadata = {
  title: "用户服务协议 - 养房 Tend",
};

const UPDATED_AT = "2026 年 5 月 11 日";
const EFFECTIVE_AT = "2026 年 5 月 11 日";

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-[#FBEEE9]/30">
      <div className="max-w-3xl mx-auto px-4 md:px-8 py-6 md:py-10">
        <Link
          href="/login"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6"
        >
          <ArrowLeft className="h-4 w-4" /> 返回登录
        </Link>

        <article className="bg-white rounded-2xl shadow-sm p-6 md:p-10 prose prose-sm md:prose-base max-w-none">
          <h1 className="text-2xl md:text-3xl font-bold text-[#C8553D] mb-2">养房 Tend 用户服务协议</h1>
          <p className="text-sm text-muted-foreground mb-8">
            更新日期：{UPDATED_AT} ｜ 生效日期：{EFFECTIVE_AT}
          </p>

          <Section title="一、协议双方">
            <p>
              本协议由 <strong>深圳市一铠科技有限公司</strong>（统一社会信用代码 <code>91440300MADJDXM09R</code>，
              以下简称"我们"或"公司"）与使用养房 Tend 软件及相关服务的用户（以下简称"您"或"用户"）共同订立。
            </p>
            <p>
              您在注册、登录或使用养房 Tend 任何功能前，应当仔细阅读、充分理解本协议全部条款，
              <strong>尤其是以加粗或下划线标注的限制、免责条款</strong>。一旦您完成注册或开始使用本服务，
              即视为您已充分理解并同意接受本协议的全部约束。
            </p>
          </Section>

          <Section title="二、服务说明">
            <p>
              养房 Tend（以下简称"本服务"）是公司面向中国大陆个人房东推出的轻量化租赁管理工具，
              功能包括但不限于：
            </p>
            <ul>
              <li>房源、租客、租约的信息录入与管理</li>
              <li>账单自动生成、收款记录、状态追踪</li>
              <li>水、电、气表读数登记与历史查询</li>
              <li>合同附件上传与查阅</li>
              <li>AI 收款截图自动识别、AI 抄表识别等智能功能</li>
              <li>到期提醒、家庭组多人协作</li>
              <li>付费版（"Pro"）提供的微信自动提醒、无限房源等增值功能</li>
            </ul>
            <p>
              公司有权根据业务发展需要调整、新增、停止部分服务，并通过应用内通知、公告或站内信形式告知用户。
            </p>
          </Section>

          <Section title="三、账号注册与使用">
            <p>
              <strong>3.1 注册资格。</strong>您应当为年满 18 周岁的具有完全民事行为能力的自然人。
              若您为限制民事行为能力人，应当在监护人同意并陪同下使用本服务，否则您与监护人需承担因此产生的全部后果。
            </p>
            <p>
              <strong>3.2 账号实名。</strong>您应使用真实有效的邮箱或手机号注册账号，并对账号下的一切活动负责。
              账号不得转让、出借、出售给他人使用。
            </p>
            <p>
              <strong>3.3 密码安全。</strong>您应妥善保管账号密码。如因您自身原因导致账号泄露所产生的损失，
              由您自行承担。如发现账号被盗用，应立即通知公司。
            </p>
          </Section>

          <Section title="四、用户行为规范">
            <p>您承诺在使用本服务过程中遵守中华人民共和国法律法规，且不得有以下行为：</p>
            <ul>
              <li>上传、传播违反《网络安全法》《数据安全法》《个人信息保护法》等法律法规的内容</li>
              <li>录入虚假房源、虚假租客信息用于欺诈、洗钱、逃税等非法目的</li>
              <li>未经租客同意，上传租客身份证、银行卡等敏感信息</li>
              <li>恶意攻击系统、绕过付费墙、滥用 AI 接口（如批量调用、爬取数据）</li>
              <li>使用爬虫、机器人等自动化程序访问本服务</li>
              <li>对软件进行逆向工程、反编译、二次分发</li>
              <li>任何侵犯公司或第三方知识产权、合法权益的行为</li>
            </ul>
            <p>
              <strong>如您违反上述约定，公司有权立即暂停或终止您的账号</strong>，
              并保留追究您法律责任的权利。由此造成公司或第三方损失的，您应承担相应赔偿责任。
            </p>
          </Section>

          <Section title="五、知识产权">
            <p>
              <strong>5.1 软件本身。</strong>养房 Tend 软件的著作权、商标权、相关源代码、UI 设计、文档资料、
              品牌名称（包括"养房 Tend"、"Tend"等中英文标识）的全部知识产权归
              <strong>深圳市一铠科技有限公司</strong>所有，受《中华人民共和国著作权法》《商标法》等法律保护。
            </p>
            <p>
              <strong>5.2 用户数据。</strong>您通过本服务录入的房源、租客、租约、账单、抄表、合同等业务数据的所有权归您。
              您授予公司在为您提供服务所必需的范围内使用、存储、备份这些数据的权利。
            </p>
            <p>
              <strong>5.3 AI 输出。</strong>本服务通过 AI 模型识别截图、抄表图片产生的结构化数据属于您，
              但因 AI 技术固有特性，结果可能存在偏差，您应在使用前自行核对。
            </p>
          </Section>

          <Section title="六、付费服务">
            <p>
              <strong>6.1 收费项目。</strong>本服务采用"免费基础版 + 付费增值版（Pro）"模式。
              具体收费项目、价格、订阅周期以您下单页面所展示的信息为准。
            </p>
            <p>
              <strong>6.2 自动续费。</strong>若您订阅按月、按季、按年的连续付费产品，公司将通过微信支付或支付宝
              在每个计费周期到期日自动扣款。您可随时在订阅管理页关闭自动续费，关闭后当期权益保留至到期，下期不再扣款。
            </p>
            <p>
              <strong>6.3 退款政策。</strong>
              数字服务的特性决定订阅一经开通即时生效，原则上不予退款。
              <strong>但若您在订阅后 7 日内未实际使用任何付费功能，可联系客服申请全额退款</strong>。
              其他情形下的退款，由公司根据实际使用情况个案处理。
            </p>
            <p>
              <strong>6.4 发票。</strong>您可在订阅成功后通过设置页申请开具增值税电子普通发票，
              抬头需与您提供的信息一致。
            </p>
          </Section>

          <Section title="七、服务变更与终止">
            <p>
              <strong>7.1 服务变更。</strong>公司保留根据业务发展、技术升级、法律法规要求随时变更服务内容、功能、
              界面、价格的权利，并通过应用内通知告知用户。
            </p>
            <p>
              <strong>7.2 账号注销。</strong>您可随时通过设置页申请注销账号。注销后，您的业务数据将在 30 日内
              从公司服务器中永久删除，无法恢复。<strong>注销前请自行导出或备份重要数据。</strong>
            </p>
            <p>
              <strong>7.3 服务终止。</strong>若公司因业务调整决定终止整体服务，将至少提前 60 日发布公告，
              并提供数据导出工具，协助用户完成数据迁移。
            </p>
          </Section>

          <Section title="八、免责声明">
            <p>
              <strong>8.1 工具属性。</strong>养房 Tend 是房东自用的<strong>记录与管理工具</strong>，
              公司<strong>不</strong>是租赁合同的当事方、担保方、居间人或代理人。
              您与租客之间的租赁纠纷、押金争议、违约责任等由您与租客自行协商或通过法律途径解决，与公司无关。
            </p>
            <p>
              <strong>8.2 AI 准确性。</strong>AI 识别功能存在固有误差（如截图模糊、字体模糊、光线不佳等情况下识别率下降），
              <strong>您在采纳 AI 识别结果前应自行核对数字、金额、日期的准确性</strong>。
              因您未核对而产生的任何损失，公司不承担责任。
            </p>
            <p>
              <strong>8.3 不可抗力。</strong>因地震、洪水、战争、政府行为、网络故障、电力中断、第三方服务（云服务商、
              微信、支付宝等）故障导致的服务中断或数据损失，公司在合理范围内采取补救措施，但不承担赔偿责任。
            </p>
            <p>
              <strong>8.4 第三方接入。</strong>本服务可能接入微信公众号、微信支付、支付宝、阿里云等第三方服务，
              您使用这些服务时还需同意该第三方的协议，相关风险由第三方承担。
            </p>
          </Section>

          <Section title="九、隐私保护">
            <p>
              公司高度重视您的个人信息保护。我们如何收集、使用、存储、共享您的信息，请详细阅读
              <Link href="/privacy" className="text-[#C8553D] underline">《隐私政策》</Link>。
              使用本服务即视为您同意隐私政策的全部约定。
            </p>
          </Section>

          <Section title="十、协议变更">
            <p>
              公司有权根据法律法规、政策变更、产品迭代等情况修改本协议。修改后将通过应用内通知、邮件或公告告知您，
              <strong>您继续使用本服务即视为接受修改后的协议</strong>。如您不同意修改，应停止使用本服务并申请注销账号。
            </p>
          </Section>

          <Section title="十一、法律适用与争议解决">
            <p>
              本协议的订立、履行、解释及争议解决均适用中华人民共和国法律。
              因本协议产生的争议，双方应首先友好协商；协商不成的，
              <strong>任何一方有权向公司注册地（深圳市）有管辖权的人民法院提起诉讼</strong>。
            </p>
          </Section>

          <Section title="十二、联系方式">
            <ul>
              <li>公司名称：深圳市一铠科技有限公司</li>
              <li>统一社会信用代码：91440300MADJDXM09R</li>
              <li>客服邮箱：support@yikai.tech（暂用占位，待启用后更新）</li>
              <li>客服微信：通过应用内"设置 → 联系客服"获取</li>
            </ul>
          </Section>

          <p className="text-sm text-muted-foreground mt-10 pt-6 border-t">
            本协议最终解释权归深圳市一铠科技有限公司所有。如有任何疑问，欢迎随时联系我们。
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
