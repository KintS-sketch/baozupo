/**
 * 房屋租赁合同 · 直租模板（房东 + 租客 双签）
 *
 * v1 草稿条款，待法务审定后替换。
 */

import type PDFDocument from "pdfkit";

export interface DirectTemplateData {
  contract_id: string;
  landlord: { name: string; phone: string; id_number: string };
  tenant: { name: string; phone: string; id_number: string };
  property: { name: string; address: string; area_sqm?: number | null };
  lease: {
    start_date: string;        // YYYY-MM-DD
    end_date: string;
    monthly_rent: number;
    deposit: number;
    rent_due_day: number;
    payment_cycle: string;     // monthly / quarterly / yearly
  };
  generated_at: string;        // ISO，合同生成时间
}

/** 把直租合同正文写入 pdfkit doc（不含审计页；签字框预留）。*/
export function renderDirectContract(
  doc: typeof PDFDocument.prototype,
  data: DirectTemplateData
) {
  // ===== 标题 =====
  doc.font("CJK-Bold").fontSize(20).text("房屋租赁合同", { align: "center" });
  doc.moveDown(0.5);
  doc.font("CJK").fontSize(10).text(`合同编号：${data.contract_id}`, { align: "right" });
  doc.text(`生成时间：${formatDate(data.generated_at)}`, { align: "right" });
  doc.moveDown(1.5);

  // ===== 双方信息 =====
  doc.font("CJK-Bold").fontSize(12).text("出租方（甲方 · 房东）");
  doc.font("CJK").fontSize(10);
  doc.text(`姓名：${data.landlord.name}`);
  doc.text(`联系电话：${data.landlord.phone}`);
  doc.text(`身份证号：${maskId(data.landlord.id_number)}`);
  doc.moveDown(0.5);

  doc.font("CJK-Bold").fontSize(12).text("承租方（乙方 · 租客）");
  doc.font("CJK").fontSize(10);
  doc.text(`姓名：${data.tenant.name}`);
  doc.text(`联系电话：${data.tenant.phone}`);
  doc.text(`身份证号：${maskId(data.tenant.id_number)}`);
  doc.moveDown(1.5);

  // ===== 第一条 房屋情况 =====
  doc.font("CJK-Bold").fontSize(12).text("第一条 房屋基本情况");
  doc.font("CJK").fontSize(10);
  doc.text(`房屋名称：${data.property.name}`);
  doc.text(`详细地址：${data.property.address}`);
  if (data.property.area_sqm) {
    doc.text(`建筑面积：${data.property.area_sqm} ㎡`);
  }
  doc.text("甲方保证依法对该房屋享有出租权，房屋无产权争议。");
  doc.moveDown(0.5);

  // ===== 第二条 租赁期限 =====
  doc.font("CJK-Bold").fontSize(12).text("第二条 租赁期限");
  doc.font("CJK").fontSize(10);
  doc.text(`租赁期自 ${data.lease.start_date} 起至 ${data.lease.end_date} 止。`);
  doc.text("租期届满乙方应按时返还房屋；如双方协商续租，应另签续租协议。");
  doc.moveDown(0.5);

  // ===== 第三条 租金与押金 =====
  doc.font("CJK-Bold").fontSize(12).text("第三条 租金及押金");
  doc.font("CJK").fontSize(10);
  doc.text(`月租金：人民币 ${data.lease.monthly_rent.toFixed(2)} 元（大写：${toChineseAmount(data.lease.monthly_rent)} 元整）`);
  doc.text(`押金：人民币 ${data.lease.deposit.toFixed(2)} 元，乙方于交付日一并支付，租期届满无违约的，由甲方在房屋交还后 7 日内无息退还。`);
  doc.text(`付款周期：${humanizeCycle(data.lease.payment_cycle)}付`);
  doc.text(`付款日：每${humanizeCycle(data.lease.payment_cycle)}的第 ${data.lease.rent_due_day} 日（含当日）前，乙方将当期租金支付至甲方指定账户。`);
  doc.moveDown(0.5);

  // ===== 第四条 双方权利义务 =====
  doc.font("CJK-Bold").fontSize(12).text("第四条 双方权利义务");
  doc.font("CJK").fontSize(10);
  doc.text("一、甲方应于交付日前将房屋以适于约定用途的状态交付乙方使用，水电气等基础设施正常可用。");
  doc.text("二、乙方应按时支付租金，妥善使用房屋及其附属设施，不得擅自改建、扩建。");
  doc.text("三、租期内房屋自然损耗及结构性维修由甲方承担；因乙方过失造成的损坏由乙方承担维修责任。");
  doc.text("四、乙方未经甲方书面同意不得转租或分租。");
  doc.text("五、租期内任何一方需提前解除合同的，应提前 30 日书面通知对方，并按本合同第五条承担相应违约责任。");
  doc.moveDown(0.5);

  // ===== 第五条 违约责任 =====
  doc.font("CJK-Bold").fontSize(12).text("第五条 违约责任");
  doc.font("CJK").fontSize(10);
  doc.text("一、乙方逾期支付租金超过 7 日的，每日按当期租金 1% 支付违约金；超过 30 日的，甲方有权单方解除合同并扣除押金。");
  doc.text("二、甲方违反本合同约定单方提前收回房屋的，应退还押金并按一个月租金支付违约金。");
  doc.text("三、其他违约情形，违约方应赔偿守约方因此造成的实际损失。");
  doc.moveDown(0.5);

  // ===== 第六条 争议解决 =====
  doc.font("CJK-Bold").fontSize(12).text("第六条 争议解决");
  doc.font("CJK").fontSize(10);
  doc.text("本合同履行过程中产生的争议，由双方友好协商解决；协商不成的，向房屋所在地人民法院起诉。");
  doc.moveDown(0.5);

  // ===== 第七条 其他 =====
  doc.font("CJK-Bold").fontSize(12).text("第七条 其他约定");
  doc.font("CJK").fontSize(10);
  doc.text("一、本合同采用电子签约方式签署，依据《中华人民共和国电子签名法》第十三条、第十四条，电子签名与手写签名具有同等法律效力。");
  doc.text("二、本合同自双方完成电子签字之日起生效。");
  doc.text("三、本合同签署完成后，由养房 Tend 平台存证保管。");
  doc.moveDown(1);

  // ===== 签字页 =====
  doc.addPage();
  doc.font("CJK-Bold").fontSize(14).text("签 字 页", { align: "center" });
  doc.moveDown(2);

  doc.font("CJK").fontSize(10);
  doc.text("出租方（甲方·房东）签字：", { continued: false });
  doc.rect(doc.x, doc.y + 6, 200, 60).stroke();
  doc.moveDown(5);
  doc.text(`姓名：${data.landlord.name}`);
  doc.text(`日期：______________`);
  doc.moveDown(2);

  doc.text("承租方（乙方·租客）签字：", { continued: false });
  doc.rect(doc.x, doc.y + 6, 200, 60).stroke();
  doc.moveDown(5);
  doc.text(`姓名：${data.tenant.name}`);
  doc.text(`日期：______________`);
}

function maskId(id: string | null | undefined): string {
  if (!id) return "—";
  if (id.length < 10) return id;
  return id.slice(0, 6) + "********" + id.slice(-4);
}

function humanizeCycle(c: string): string {
  return ({ monthly: "月", quarterly: "季", yearly: "年" } as Record<string, string>)[c] ?? c;
}

function formatDate(iso: string): string {
  return iso.slice(0, 10);
}

/** 简易金额大写（v1 用阿拉伯数字代替，下一版接 chinese-number 库）*/
function toChineseAmount(n: number): string {
  return n.toFixed(2);
}
