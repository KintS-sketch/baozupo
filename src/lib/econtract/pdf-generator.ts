/**
 * PDF 初稿生成（无签字、无审计页）。
 *
 * 使用 pdfkit 服务端渲染 + 系统中文字体（runtime 解析）。
 * 输出 Buffer，调用方负责上传 Storage。
 */

import PDFDocument from "pdfkit";
import { resolveCjkFont } from "./fonts";
import { renderDirectContract, type DirectTemplateData } from "./templates/direct";

export type TemplateData = DirectTemplateData; // Task 16 加 AgentTemplateData 联合

export async function generateInitialPdf(
  templateType: "direct" | "agent",
  data: TemplateData
): Promise<Buffer> {
  if (templateType !== "direct") {
    // Task 16 实现 agent
    throw new Error("agent 模板尚未实现（待 Task 16）");
  }

  const cjk = resolveCjkFont();

  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 50,
      info: {
        Title: "房屋租赁合同",
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

    renderDirectContract(doc, data);
    doc.end();
  });
}
