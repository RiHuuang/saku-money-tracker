// Expensive JSON work runs on the device. Each Worker transfer stays bounded.
export type SnapshotRequest = (path: string, options?: RequestInit) => Promise<Response>;
export const SNAPSHOT_CHUNK_BYTES = 250_000;

export async function uploadSnapshot(json: string, baseRevision: number, send: SnapshotRequest): Promise<any> {
  const body = new Blob([json], { type: "application/json" });
  if (body.size > 10_000_000) throw new Error("Saku data exceeds 10 MB");
  if (body.size <= SNAPSHOT_CHUNK_BYTES) return (await send(`/v2/sync?baseRevision=${baseRevision}`, {
    method: "PUT", headers: { "x-saku-version": "3" }, body,
  })).json();
  const upload = await (await send("/v2/sync/start", { method: "POST", body: JSON.stringify({ baseRevision, size: body.size }) })).json();
  if (typeof upload.id !== "string" || upload.chunkBytes !== SNAPSHOT_CHUNK_BYTES) throw new Error("Invalid backup upload response");
  for (let offset = 0; offset < body.size; offset += SNAPSHOT_CHUNK_BYTES) {
    await send(`/v2/sync/chunk?id=${encodeURIComponent(upload.id)}&index=${offset / SNAPSHOT_CHUNK_BYTES}`, {
      method: "PUT", headers: { "content-type": "application/octet-stream" }, body: body.slice(offset, offset + SNAPSHOT_CHUNK_BYTES),
    });
  }
  return (await send("/v2/sync/finish", { method: "POST", body: JSON.stringify({ id: upload.id }) })).json();
}

export async function downloadSnapshot(response: Response, send: SnapshotRequest): Promise<unknown | null> {
  if (response.status === 204) return null;
  let encoding = response.headers.get("x-saku-encoding");
  let body = response.body;
  if (encoding === "manifest") {
    const manifest = await response.json();
    if (!Number.isSafeInteger(manifest.size) || manifest.size < 1 || manifest.size > 10_100_000 || !Array.isArray(manifest.parts) || manifest.parts.length < 1 || manifest.parts.length > 40) throw new Error("Invalid backup manifest");
    const pieces: Blob[] = [];
    let total = 0;
    for (const part of manifest.parts) {
      if (typeof part.key !== "string" || !Number.isSafeInteger(part.size) || part.size < 1 || part.size > 10_100_000) throw new Error("Invalid backup part");
      for (let offset = 0; offset < part.size; offset += SNAPSHOT_CHUNK_BYTES) {
        const chunk = await send(`/v2/sync/chunk?key=${encodeURIComponent(part.key)}&offset=${offset}`);
        const piece = await chunk.blob();
        if (piece.size !== Math.min(SNAPSHOT_CHUNK_BYTES, part.size - offset)) throw new Error("Cloud backup is incomplete");
        pieces.push(piece); total += piece.size;
      }
    }
    if (total !== manifest.size) throw new Error("Cloud backup is incomplete");
    body = new Blob(pieces).stream(); encoding = manifest.encoding;
  }
  if (!body || (encoding !== "identity" && encoding !== "gzip")) throw new Error("Unsupported cloud backup encoding");
  return new Response(encoding === "gzip" ? body.pipeThrough(new DecompressionStream("gzip")) : body).json();
}
