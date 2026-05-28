/**
 * PDF 初稿生成（无签字、无审计页）。
 *
 * 使用 pdfkit 服务端渲染 + 系统中文字体（runtime 解析）。
 * 输出 Buffer，调用方负责上传 Storage。
 *
 * 支持两种模板：
 * - "direct": 房东直租合同（房东 + 租客双签）
 * - "broker": 居间服务协议（房东 + 中介双签）
 */

import PDFDocument from "pdfkit";
import { resolveCjkFont } from "./fonts";
import { renderDirectContract, type DirectTemplateData } from "./templates/direct";
import { renderBrokerContract, type BrokerTemplateData } from "./templates/broker";

export type TemplateData = DirectTemplateData | BrokerTemplateData;

export async function generateInitialPdf(
  templateType: "direct" | "broker",
  data: TemplateData
): Promise<Buffer> {
  const cjk = resolveCjkFont();

  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 50,
      info: {
        Title: templateType === "broker" ? "房屋租赁居间服务协议" : "房屋租赁合同",
        Author: "养房 Tend",
        Creator: "养房 Tend 电子签约",
      },
    });

    // 注册中文字体。TTC 需指定 family；TTF/OTF 不用。
    if (cjk.family) {
      doc.registerFont("CJK", cjk.file, cjk.family);
      doc.registerFont("CJK-Bold", cjk.file, cjk.family);
    } else {
      doc.registerFont("CJK", cjk.file);
      doc.registerFont("CJK-Bold", cjk.file);
    }

    const buffers: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => buffers.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(buffers)));
    doc.on("error", reject);

    if (templateType === "broker") {
      renderBrokerContract(doc, data as BrokerTemplateData);
    } else {
      renderDirectContract(doc, data as DirectTemplateData);
    }

    doc.end();
  });
}
