import { commands, type TerminalInfo, type TerminalOpenReq } from "@/lib/backend/bindings";

export type TerminalApi = Pick<
  typeof commands,
  "terminalOpen" | "terminalRead" | "terminalWrite" | "terminalResize" | "terminalClose"
>;

export type TerminalSink = {
  output: (bytes: Uint8Array, done: () => void) => void;
  opened: (info: TerminalInfo) => void;
  exited: (code: number | null) => void;
  error: (error: unknown) => void;
};

/** One outstanding read per PTY; only request more once xterm has parsed it. */
export class TerminalConnection {
  private id: string | null = null;
  private closed = false;
  private ended = false;
  private input = Promise.resolve();
  private queuedInput = 0;
  private resizeRunning = false;
  private dimensions: { cols: number; rows: number } | null = null;
  private releaseOutput: (() => void) | null = null;

  constructor(
    private sink: TerminalSink,
    private api: TerminalApi = commands,
  ) {}

  async start(req: TerminalOpenReq) {
    try {
      const info = await this.api.terminalOpen(req);
      this.id = info.id;
      if (this.closed) {
        await this.release();
        return;
      }
      this.sink.opened(info);
      void this.flushResize();
      await this.pump();
    } catch (error) {
      if (!this.closed) {
        this.sink.error(error);
        if (this.id) this.sink.exited(null);
      }
      this.ended = true;
      await this.release();
    }
  }

  private async pump() {
    while (!this.closed && this.id) {
      const output = await this.api.terminalRead(this.id);
      if (this.closed) break;
      if (output.data.length) {
        await new Promise<void>((resolve) => {
          this.releaseOutput = resolve;
          this.sink.output(new Uint8Array(output.data), () => {
            this.releaseOutput = null;
            resolve();
          });
        });
      }
      if (this.closed) break;
      if (output.error) this.sink.error(output.error);
      if (output.exited) {
        this.ended = true;
        this.sink.exited(output.exitCode);
        await this.release();
        break;
      }
    }
  }

  write(data: string) {
    if (this.closed || this.ended || !this.id || !data) return;
    if (this.queuedInput + data.length > 1024 * 1024) {
      this.sink.error(new Error("Terminal input queue is full; wait before pasting more."));
      return;
    }
    this.queuedInput += data.length;
    this.input = this.input
      .then(async () => {
        // Keep UTF-16 surrogate pairs intact; each UTF-8 IPC write stays below 64 KiB.
        for (let from = 0; from < data.length;) {
          if (this.closed || this.ended || !this.id) return;
          let to = Math.min(from + 8192, data.length);
          const last = data.charCodeAt(to - 1);
          if (to < data.length && last >= 0xd800 && last <= 0xdbff) to--;
          await this.api.terminalWrite({ id: this.id, data: data.slice(from, to) });
          from = to;
        }
      })
      .catch((error) => {
        if (!this.closed && !this.ended) this.sink.error(error);
      })
      .finally(() => {
        this.queuedInput -= data.length;
      });
  }

  resize(cols: number, rows: number) {
    this.dimensions = {
      cols: Math.min(500, Math.max(2, cols)),
      rows: Math.min(300, Math.max(1, rows)),
    };
    void this.flushResize();
  }

  private async flushResize() {
    if (this.resizeRunning || !this.id || this.closed || this.ended) return;
    this.resizeRunning = true;
    try {
      while (this.dimensions && this.id && !this.closed && !this.ended) {
        const dimensions = this.dimensions;
        this.dimensions = null;
        await this.api.terminalResize({ id: this.id, ...dimensions });
      }
    } catch (error) {
      if (!this.closed && !this.ended) this.sink.error(error);
    } finally {
      this.resizeRunning = false;
    }
  }

  private async release() {
    const id = this.id;
    this.id = null;
    if (id) {
      try {
        await this.api.terminalClose(id);
      } catch (error) {
        this.sink.error(error);
      }
    }
  }

  async close() {
    this.closed = true;
    this.releaseOutput?.();
    this.releaseOutput = null;
    await this.release();
  }
}
