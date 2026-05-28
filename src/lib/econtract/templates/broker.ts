/**
 * 房屋租赁居间服务协议模板（房东 + 中介双签）
 *
 * 与直租合同同期签订，反映"居间合同"独立法律关系。
 */

import type PDFDocument from "pdfkit";
import { numberToChinese } from "@/lib/utils/number-to-chinese";

export interface BrokerTemplateData {
  contract_id: string;
  landlord: { name: string; phone: string; id_number: string };
  broker: { name: string; phone: string; id_number: string };
  property: { name: string; address: string; city?: string | null };
  lease: { start_date: string; monthly_rent: number };
  agent_fee: number;
  generated_at: string;
}

export function renderBrokerContract(
  doc: typeof PDFDocument.prototype,
  data: BrokerTemplateData
) {
  // ===== 标题 =====
  doc.font("CJK-Bold").fontSize(20).text("房屋租赁居间服务协议", { align: "center" });
  doc.moveDown(0.5);
  doc.font("CJK").fontSize(10).text(`合同编号：${data.contract_id}`, { align: "right" });
  doc.text(`生成时间：${formatDate(data.generated_at)}`, { align: "right" });
  doc.moveDown(1.5);

  // ===== 双方信息 =====
  doc.font("CJK-Bold").fontSize(12).text("委托方（甲方 · 房东）");
  doc.font("CJK").fontSize(10);
  doc.text(`姓名：${data.landlord.name}`);
  doc.text(`联系电话：${data.landlord.phone}`);
  doc.text(`身份证号：${maskId(data.landlord.id_number)}`);
  doc.moveDown(0.5);

  doc.font("CJK-Bold").fontSize(12).text("居间方(乙方 · 中介)");
  doc.font("CJK").fontSize(10);
  doc.text(`姓名：${data.broker.name}`);
  doc.text(`联系电话：${data.broker.phone}`);
  doc.text(`身份证号：${maskId(data.broker.id_number)}`);
  doc.moveDown(1.5);

  // ===== 第一条 委托事项 =====
  doc.font("CJK-Bold").fontSize(12).text("第一条 委托事项");
  doc.font("CJK").fontSize(10);
  doc.text(`甲方委托乙方就坐落于 ${data.property.address} 的房屋（${data.property.name}）寻找承租人并促成租赁合同签订。`);
  doc.text(`本次促成的租赁合同自 ${data.lease.start_date} 起生效，月租金人民币 ${data.lease.monthly_rent.toFixed(2)} 元。`);
  doc.moveDown(0.5);

  // ===== 第二条 居间费用 =====
  doc.font("CJK-Bold").fontSize(12).text("第二条 居间费用及支付");
  doc.font("CJK").fontSize(10);
  doc.text(`一、居间费总额：人民币 ${data.agent_fee.toFixed(2)} 元（大写：${numberToChinese(data.agent_fee)}）`);
  doc.text("二、支付义务方：甲方（房东）。");
  doc.text("三、支付时间：在《房屋租赁合同》正式签订后 7 个自然日内一次性支付。");
  doc.text("四、支付方式：银行转账 / 微信 / 支付宝 / 现金（双方约定）。");
  doc.moveDown(0.5);

  // ===== 第三条 乙方义务 =====
  doc.font("CJK-Bold").fontSize(12).text("第三条 乙方义务");
  doc.font("CJK").fontSize(10);
  doc.text("一、向甲方提供真实、合法的承租人身份信息及联系方式。");
  doc.text("二、协助甲方与承租人达成租赁合同的签订。");
  doc.text("三、必要时协助甲方与承租人完成房屋交接。");
  doc.text("四、乙方对所提供的身份信息真实性负责。");
  doc.moveDown(0.5);

  // ===== 第四条 甲方义务 =====
  doc.font("CJK-Bold").fontSize(12).text("第四条 甲方义务");
  doc.font("CJK").fontSize(10);
  doc.text("一、提供真实、合法的房屋出租信息。");
  doc.text("二、按本协议第二条约定足额支付居间费。");
  doc.moveDown(0.5);

  // ===== 第五条 违约责任 =====
  doc.font("CJK-Bold").fontSize(12).text("第五条 违约责任");
  doc.font("CJK").fontSize(10);
  doc.text("一、甲方居间费逾期支付超过 30 日的，每日按居间费总额 0.5% 支付违约金。");
  doc.text("二、乙方提供虚假信息致使租赁合同无法履行或解除的，应全额退还已收取的居间费。");
  doc.moveDown(0.5);

  // ===== 第六条 争议解决 =====
  doc.font("CJK-Bold").fontSize(12).text("第六条 争议解决");
  doc.font("CJK").fontSize(10);
  const city = data.property.city || "房屋所在地";
  doc.text(`本协议履行过程中产生的争议，由双方友好协商解决；协商不成的，向${city}有管辖权的人民法院起诉。`);
  doc.moveDown(0.5);

  // ===== 第七条 其他 =====
  doc.font("CJK-Bold").fontSize(12).text("第七条 其他约定");
  doc.font("CJK").fontSize(10);
  doc.text("一、本协议采用电子签约方式签署，依据《中华人民共和国电子签名法》第十三条、第十四条，电子签名与手写签名具有同等法律效力。");
  doc.text("二、本协议与《房屋租赁合同》同期签订，双方在两份合同上的签字共同生效。");
  doc.text("三、本协议自双方完成电子签字之日起生效。");
  doc.moveDown(1);

  // ===== 签字页 =====
  doc.addPage();
  doc.font("CJK-Bold").fontSize(14).text("签 字 页", { align: "center" });
  doc.moveDown(2);

  doc.font("CJK").fontSize(10);
  doc.text("委托方（甲方·房东）签字：", { continued: false });
  doc.rect(doc.x, doc.y + 6, 200, 60).stroke();
  doc.moveDown(5);
  doc.text(`姓名：${data.landlord.name}`);
  doc.text(`日期：______________`);
  doc.moveDown(2);

  doc.text("居间方（乙方·中介）签字：", { continued: false });
  doc.rect(doc.x, doc.y + 6, 200, 60).stroke();
  doc.moveDown(5);
  doc.text(`姓名：${data.broker.name}`);
  doc.text(`日期：______________`);
}

function maskId(id: string | null | undefined): string {
  if (!id) return "—";
  if (id.length < 10) return id;
  return id.slice(0, 6) + "********" + id.slice(-4);
}

function formatDate(iso: string): string {
  return iso.slice(0, 10);
}
