/**
 * GPU time per render section, from EXT_disjoint_timer_query_webgl2 (desktop Chrome has it, most phones
 * do not). Only created when profiling (`?perf` or the debug handle), so normal play pays nothing.
 * Sections must not nest: one TIME_ELAPSED query can be active at a time. Results arrive a few frames
 * late and are averaged over a sliding window.
 */
export class GpuTimer {
  /** Average GPU milliseconds per section over the last `window` samples. */
  readonly ms: Record<string, number> = {};
  private readonly ext: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number };
  private readonly pool: WebGLQuery[] = [];
  private readonly pending: { label: string; query: WebGLQuery }[] = [];
  private readonly samples: Record<string, number[]> = {};
  private active: { label: string; query: WebGLQuery } | null = null;

  private constructor(
    private readonly gl: WebGL2RenderingContext,
    ext: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number },
    private readonly window = 60,
  ) {
    this.ext = ext;
  }

  /** A timer, or null when the extension is missing. */
  static create(gl: WebGL2RenderingContext): GpuTimer | null {
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
    return ext ? new GpuTimer(gl, ext) : null;
  }

  begin(label: string): void {
    if (this.active) this.end();
    const query = this.pool.pop() ?? this.gl.createQuery();
    if (!query) return;
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, query);
    this.active = { label, query };
  }

  end(): void {
    if (!this.active) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending.push(this.active);
    this.active = null;
  }

  /** Collect finished queries, oldest first. Call once per frame, outside any section. */
  poll(): void {
    const gl = this.gl;
    const disjoint = gl.getParameter(this.ext.GPU_DISJOINT_EXT) as boolean;
    while (this.pending.length > 0) {
      const { label, query } = this.pending[0];
      if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) break;
      this.pending.shift();
      const ns = gl.getQueryParameter(query, gl.QUERY_RESULT) as number;
      this.pool.push(query);
      if (disjoint) continue;
      const list = (this.samples[label] ??= []);
      list.push(ns / 1e6);
      if (list.length > this.window) list.shift();
      this.ms[label] = list.reduce((a, b) => a + b, 0) / list.length;
    }
  }

  /** Forget the averages (after a quality change, so stale samples do not linger). */
  clear(): void {
    for (const key of Object.keys(this.samples)) delete this.samples[key];
    for (const key of Object.keys(this.ms)) delete this.ms[key];
  }
}
