// A global daily counter, so a bot that gets past the per-visitor rate limits still can't
// spend more than a fixed number of LLM calls per day. A Durable Object handles one request
// at a time, so the read-then-write below can't race.
import { DurableObject } from "cloudflare:workers";

export class Budget extends DurableObject {
  /** Counts one use of `kind` today (UTC). Returns false, without counting, if the limit is reached. */
  async take(kind: string, limit: number): Promise<boolean> {
    const day = new Date().toISOString().slice(0, 10);
    const key = `${day}:${kind}`;
    const used = (await this.ctx.storage.get<number>(key)) ?? 0;
    if (used >= limit) return false;
    await this.ctx.storage.put(key, used + 1);
    if (used === 0) {
      // First use today: drop earlier days' counters.
      const old = [...(await this.ctx.storage.list()).keys()].filter((k) => !k.startsWith(day));
      if (old.length) await this.ctx.storage.delete(old);
    }
    return true;
  }
}
