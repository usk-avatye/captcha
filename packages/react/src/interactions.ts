export type PathPoint = { x: number; y: number; t: number; drag: number };
export type InteractionMetrics = {
  firstInteractionMs: number | null;
  solveMs: number | null;
  missCount: number;
  path: PathPoint[] | null;
};
export type InteractionSummary = { challengeId: string; revision: number; metrics: InteractionMetrics };
type Options = {
  enabled?: boolean;
  pathSampleRate?: number;
  now?: () => number;
  random?: () => number;
  deliver: (body: InteractionSummary) => Promise<boolean>;
};

/** 한 인증의 활성 시간과 제한된 경로를 누적한다. 이동 중에는 전송하지 않는다. */
export class InteractionRecorder {
  private options: Options;
  private now: () => number;
  private challengeId: string | null = null;
  private open = false;
  private visible = true;
  private elapsed = 0;
  private started: number | null = null;
  private metrics: InteractionMetrics;
  private drag = 0;
  private dragging = false;
  private pending: PathPoint | null = null;
  private lastSample = -Infinity;
  private snapshot: InteractionSummary | null = null;
  private signature = '';
  private delivered = false;
  private inFlight: InteractionSummary | null = null;

  constructor(options: Options) {
    this.options = options;
    this.now = options.now ?? (() => performance.now());
    const rate = options.pathSampleRate ?? .01;
    const sampled = Number.isFinite(rate) && (options.random?.() ?? Math.random()) < Math.max(0, Math.min(1, rate));
    this.metrics = { firstInteractionMs: null, solveMs: null, missCount: 0, path: sampled ? [] : null };
  }

  private time() {
    return Math.min(86_400_000, Math.round(this.elapsed + (this.started === null ? 0 : Math.max(0, this.now() - this.started))));
  }
  private clock() {
    const elapsed = this.time();
    this.started = null;
    this.elapsed = elapsed;
    if (this.challengeId && this.open && this.visible && this.metrics.solveMs === null) this.started = this.now();
  }
  ready = (challengeId: string) => {
    if (this.options.enabled === false || this.challengeId) return;
    this.challengeId = challengeId;
    this.clock();
  };
  setOpen = (open: boolean) => {
    this.open = open;
    this.clock();
    if (!open) { this.release(); void this.flush(); }
  };
  setVisible = (visible: boolean) => {
    this.visible = visible;
    this.clock();
    if (!visible) { this.release(); void this.flush(); }
  };
  private active() {
    return this.challengeId !== null && this.open && this.visible && this.metrics.solveMs === null;
  }
  private point(x: number, y: number): PathPoint {
    const coordinate = (value: number) => Math.round(Math.max(0, Math.min(1, value)) * 10000) / 10000;
    return { x: coordinate(x), y: coordinate(y), t: this.time(), drag: this.drag };
  }
  private append(point: PathPoint) {
    const path = this.metrics.path;
    if (!path) return;
    const last = path.at(-1);
    if (last && last.x === point.x && last.y === point.y && last.t === point.t && last.drag === point.drag) return;
    if (path.length < 100) path.push(point);
    else path[99] = point;
    this.lastSample = point.t;
  }
  press = (x: number, y: number) => {
    if (!this.active() || this.dragging || !Number.isFinite(x) || !Number.isFinite(y)) return;
    this.metrics.firstInteractionMs ??= this.time();
    this.drag = Math.min(1000, this.drag + 1);
    this.dragging = true;
    this.pending = this.point(x, y);
    this.append(this.pending);
  };
  move = (x: number, y: number) => {
    if (!this.active() || !this.dragging || !Number.isFinite(x) || !Number.isFinite(y)) return;
    this.pending = this.point(x, y);
    if (this.pending.t - this.lastSample >= 100) this.append(this.pending);
  };
  release = () => {
    if (!this.dragging) return;
    if (this.pending) this.append({ ...this.pending, t: this.time() });
    this.dragging = false;
    this.pending = null;
  };
  miss = () => {
    if (this.challengeId && this.metrics.solveMs === null) this.metrics.missCount = Math.min(1000, this.metrics.missCount + 1);
  };
  passed = () => {
    if (!this.challengeId || this.metrics.solveMs !== null) return;
    this.release();
    this.metrics.solveMs = this.time();
    this.clock();
    void this.flush();
  };
  flush = async (): Promise<void> => {
    if (!this.challengeId) return;
    const signature = JSON.stringify(this.metrics);
    if (signature !== this.signature) {
      this.snapshot = { challengeId: this.challengeId, revision: (this.snapshot?.revision ?? 0) + 1,
        metrics: JSON.parse(signature) as InteractionMetrics };
      this.signature = signature;
      this.delivered = false;
    }
    const snapshot = this.snapshot!;
    if (this.delivered || this.inFlight === snapshot) return;
    this.inFlight = snapshot;
    try {
      const accepted = await this.options.deliver(snapshot);
      if (this.snapshot === snapshot) this.delivered = accepted;
    } catch { /* 다음 flush에서 같은 스냅샷으로 재시도한다. */ }
    finally { if (this.inFlight === snapshot) this.inFlight = null; }
  };
}
