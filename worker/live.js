export class UserLiveUpdates {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; }
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/ticket") {
      const { hash, sessionId, expiresAt } = await request.json();
      await this.ctx.storage.put(`ticket:${hash}`, { sessionId, expiresAt });
      await this.ctx.storage.setAlarm(expiresAt + 1000);
      return new Response(null, { status: 204 });
    }
    if (request.method === "GET" && url.pathname === "/connect") {
      const hash = url.searchParams.get("hash");
      const ticket = hash && await this.ctx.storage.get(`ticket:${hash}`);
      if (!ticket) return new Response("Ticket expired", { status: 401 });
      await this.ctx.storage.delete(`ticket:${hash}`);
      if (ticket.expiresAt < Date.now()) return new Response("Ticket expired", { status: 401 });
      const session = await this.env.DB.prepare("SELECT id FROM sessions WHERE id=? AND access_expires_at>?").bind(ticket.sessionId, Date.now()).first();
      if (!session) return new Response("Session expired", { status: 401 });
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1]);
      pair[1].serializeAttachment({ sessionId: ticket.sessionId, expiresAt: ticket.expiresAt + 15 * 60_000 });
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    if (request.method === "POST" && url.pathname === "/notify") {
      const notice = await request.text();
      for (const socket of this.ctx.getWebSockets()) {
        try {
          const sessionId = socket.deserializeAttachment()?.sessionId;
          const active = sessionId && await this.env.DB.prepare("SELECT id FROM sessions WHERE id=? AND access_expires_at>?").bind(sessionId, Date.now()).first();
          if (active) socket.send(notice);
          else socket.close(1008, "Session expired");
        } catch { try { socket.close(1011, "Connection lost"); } catch {} }
      }
      return new Response(null, { status: 204 });
    }
    if (request.method === "POST" && url.pathname === "/revoke") {
      const { sessionId } = await request.json();
      for (const socket of this.ctx.getWebSockets()) {
        if (!sessionId || socket.deserializeAttachment()?.sessionId === sessionId) socket.close(1008, "Session ended");
      }
      return new Response(null, { status: 204 });
    }
    return new Response("Not found", { status: 404 });
  }
  webSocketMessage(socket) {
    const attachment = socket.deserializeAttachment();
    if (!attachment || attachment.expiresAt < Date.now()) socket.close(1008, "Session expired");
  }
  async alarm() {
    const now = Date.now();
    const tickets = await this.ctx.storage.list({ prefix: "ticket:" });
    let next = Infinity;
    for (const [key, ticket] of tickets) {
      if (ticket.expiresAt <= now) await this.ctx.storage.delete(key);
      else next = Math.min(next, ticket.expiresAt);
    }
    if (next < Infinity) await this.ctx.storage.setAlarm(next + 1000);
  }
}
