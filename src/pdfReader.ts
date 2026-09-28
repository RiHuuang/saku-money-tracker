import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { localStatementAI } from "./localStatementAI";
import type { SourceLine } from "./pdfStatement";

GlobalWorkerOptions.workerSrc = workerUrl;

export async function readPdf(
  file: File,
  password: string,
  progress: (stage: string, fraction: number) => void,
): Promise<SourceLine[]> {
  if (file.size > 20_000_000) throw new Error("Use a PDF smaller than 20 MB");
  const task = getDocument({ data: new Uint8Array(await file.arrayBuffer()), password });
  let document: Awaited<typeof task.promise> | undefined;
  try {
    document = await task.promise;
    if (document.numPages > 50) throw new Error("Use a statement with 50 pages or fewer");
    const result: SourceLine[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const positioned = content.items.filter((item): item is typeof item & { str: string; transform: number[]; width: number } => "str" in item && "transform" in item && "width" in item);
      const groups = new Map<number, { x: number; right: number; text: string }[]>();
      for (const item of positioned) {
        const y = Math.round(item.transform[5] / 4) * 4;
        groups.set(y, [...(groups.get(y) || []), { x: item.transform[4], right: item.transform[4] + item.width, text: item.str }]);
      }
      let texts = [...groups.entries()].sort((a, b) => b[0] - a[0])
        .map(([, parts]) => {
          let right = -Infinity;
          return parts.sort((a, b) => a.x - b.x).map((p) => {
            const gap = p.x - right;
            right = Math.max(right, p.right);
            return `${gap > 2 ? " " : ""}${p.text}`;
          }).join("").replace(/\s+/g, " ").trim();
        })
        .filter(Boolean);
      if (texts.join(" ").length < 30) {
        progress(`OCR page ${pageNumber} of ${document.numPages}`, (pageNumber - 0.5) / document.numPages);
        const viewport = page.getViewport({ scale: Math.min(2, 2200 / page.getViewport({ scale: 1 }).width) });
        const canvas = window.document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Cannot render scanned page");
        await page.render({ canvas, canvasContext: context, viewport }).promise;
        const image = canvas.toDataURL("image/jpeg", 0.85).split(",")[1];
        canvas.width = 0; canvas.height = 0;
        const recognized = await localStatementAI.recognizeImage({ image });
        texts = recognized.text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      }
      result.push(...texts.map((text, i) => ({ id: `p${pageNumber}l${i + 1}`, page: pageNumber, text })));
      page.cleanup();
      progress(`Read page ${pageNumber} of ${document.numPages}`, pageNumber / document.numPages);
    }
    return result;
  } finally {
    document?.cleanup();
    await task.destroy();
  }
}
