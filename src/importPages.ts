import { getDocument, GlobalWorkerOptions, OPS } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = workerUrl;
export type ImportPage = { kind: "text"; text: string } | { kind: "image"; image: string };
const rasterOps = new Set([
  OPS.paintImageXObject, OPS.paintImageXObjectRepeat,
  OPS.paintInlineImageXObject, OPS.paintInlineImageXObjectGroup,
  OPS.paintImageMaskXObject, OPS.paintImageMaskXObjectGroup, OPS.paintImageMaskXObjectRepeat,
]);

export async function openImportPages(file: File, password = ""): Promise<{ count: number; pages: AsyncGenerator<{ number: number; content: ImportPage }> }> {
  if (file.type.startsWith("image/") || /\.(png|jpe?g|webp)$/i.test(file.name)) {
    if (file.size > 12_000_000) throw new Error("Use an image smaller than 12 MB");
    return { count: 1, pages: (async function* () { yield { number: 1, content: { kind: "image" as const, image: await downsizeImage(file) } }; })() };
  }
  if (!/\.pdf$/i.test(file.name) || file.size > 20_000_000) throw new Error("Use a PDF smaller than 20 MB");
  const task = getDocument({ data: new Uint8Array(await file.arrayBuffer()), password });
  let pdf: Awaited<typeof task.promise>;
  try {
    pdf = await task.promise;
    if (pdf.numPages > 50) throw new Error("Use a PDF with 50 pages or fewer");
  } catch (error) { await task.destroy(); throw error; }
  const count = pdf.numPages;
  const pages = (async function* () {
    try { for (let n = 1; n <= count; n++) {
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      const parts = content.items.filter((item): item is typeof item & { str: string; transform: number[]; width: number } => "str" in item && "transform" in item && "width" in item);
      const rows = new Map<number, { x: number; right: number; text: string }[]>();
      for (const part of parts) {
        const y = Math.round(part.transform[5] / 4) * 4;
        rows.set(y, [...(rows.get(y) || []), { x: part.transform[4], right: part.transform[4] + part.width, text: part.str }]);
      }
      const text = [...rows.entries()].sort((a, b) => b[0] - a[0]).map(([, line]) => {
        let right = -Infinity;
        return line.sort((a, b) => a.x - b.x).map((item) => { const gap = item.x - right; right = Math.max(right, item.right); return `${gap > 2 ? " " : ""}${item.text}`; }).join("").trim();
      }).filter(Boolean).join("\n");
      // A selectable text layer can omit a scanned transaction table of any size.
      // Send mixed pages as images so the review does not silently miss those rows.
      const hasRaster = (await page.getOperatorList()).fnArray.some((op) => rasterOps.has(op));
      if (text.length > 80 && text.length <= 24000 && !hasRaster) yield { number: n, content: { kind: "text" as const, text } };
      else {
        const viewport = page.getViewport({ scale: Math.min(2, 1900 / page.getViewport({ scale: 1 }).width) });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Could not render PDF page");
        await page.render({ canvas, canvasContext: context, viewport }).promise;
        const image = encodeImportImage(canvas);
        canvas.width = canvas.height = 0;
        yield { number: n, content: { kind: "image" as const, image } };
      }
      page.cleanup();
    } } finally { pdf.cleanup(); await task.destroy(); }
  })();
  return { count, pages };
}

async function downsizeImage(file: File): Promise<string> {
  const image = await createImageBitmap(file);
  try {
    // Preserve readable text in tall phone captures; the encoder still enforces
    // the Worker's data-URL limit after this pixel-count bound.
    const factor = Math.min(1, 1900 / image.width, Math.sqrt(4_000_000 / (image.width * image.height)));
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(image.width * factor); canvas.height = Math.ceil(image.height * factor);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not prepare this image. Try a smaller screenshot.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const data = encodeImportImage(canvas);
    canvas.width = canvas.height = 0;
    return data;
  } finally { image.close(); }
}

// Leave room below the Worker's 3 MB data-URL limit for JSON request overhead.
function encodeImportImage(canvas: HTMLCanvasElement): string {
  for (let size = 0; size < 5; size++) {
    for (const quality of [0.75, 0.65, 0.55]) {
      const data = canvas.toDataURL("image/jpeg", quality);
      if (data.startsWith("data:image/jpeg;base64,") && data.length <= 2_900_000) return data;
    }
    const smaller = document.createElement("canvas");
    smaller.width = Math.max(1, Math.floor(canvas.width * 0.85));
    smaller.height = Math.max(1, Math.floor(canvas.height * 0.85));
    const context = smaller.getContext("2d");
    if (!context) throw new Error("Could not resize this page");
    context.drawImage(canvas, 0, 0, smaller.width, smaller.height);
    canvas.width = smaller.width; canvas.height = smaller.height;
    const resized = canvas.getContext("2d");
    if (!resized) throw new Error("Could not resize this page");
    resized.drawImage(smaller, 0, 0);
    smaller.width = smaller.height = 0;
  }
  throw new Error("This page is too detailed to process. Crop it into smaller screenshots and retry.");
}
