import { ApiError } from './api.ts';
import type { CaptchaApi } from './api.ts';
import type { Creative, CompletionResult, DropPoint, FlowError, VerifyRequest, VisualPhase } from './types.ts';

export type FlowSnapshot = {
  phase: VisualPhase;
  challengeId: string | null;
  creative: Creative | null;
  lastVerify: VerifyRequest | null;
  result: CompletionResult | null;
  error: FlowError | null;
  notice: 'miss' | null;
  run: number;
  loadAttempt: number;
};

// React 밖에서도 같은 수명 규칙을 검증한다. DOM/드래그/포인트는 소유하지 않는다.
export class CaptchaFlow {
  private creativeId: string;
  private api: CaptchaApi;
  private opened = false;
  private generation = 0;
  private request: AbortController | null = null;
  private listeners = new Set<() => void>();
  private completionDelivered = false;
  private callbacks: {
    onComplete: (result: CompletionResult) => void;
    onContinue: () => void;
  } | null = null;
  private state: FlowSnapshot = {
    phase: 'loading', challengeId: null, creative: null, lastVerify: null,
    result: null, error: null, notice: null, run: 0, loadAttempt: 0,
  };

  constructor(creativeId: string, api: CaptchaApi) {
    this.creativeId = creativeId;
    this.api = api;
  }

  getSnapshot = () => this.state;
  setCallbacks = (callbacks: NonNullable<CaptchaFlow['callbacks']>) => {
    this.callbacks = callbacks;
  };
  continue = () => {
    if (this.opened && this.state.phase === 'completed' && this.completionDelivered) {
      this.callbacks?.onContinue();
    }
  };
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private update(values: Partial<FlowSnapshot>) {
    this.state = { ...this.state, ...values };
    this.listeners.forEach(listener => listener());
  }

  setOpen = (open: boolean) => {
    if (this.opened === open) return;
    this.opened = open;
    if (!open) {
      this.generation += 1;
      this.request?.abort();
      this.request = null;
      const phase = this.state.phase === 'snapping' || this.state.phase === 'revealing'
        ? 'snapping' : this.state.phase;
      this.update({ phase, run: this.state.run + 1 });
      return;
    }
    if (this.state.phase === 'loading' && !this.state.challengeId) void this.start();
    else if (this.state.phase === 'verifying' && this.state.lastVerify) void this.verify(this.state.lastVerify);
  };

  close = () => { this.setOpen(false); };

  private begin() {
    this.request?.abort();
    const controller = new AbortController();
    this.request = controller;
    const generation = ++this.generation;
    return { controller, current: () => this.opened && this.generation === generation };
  }

  private failed(operation: 'start' | 'verify', error: unknown) {
    const value = error instanceof ApiError ? error
      : new ApiError('NETWORK', '요청 결과를 확인하지 못했어요. 다시 시도해 주세요.');
    this.update({ phase: 'error', error: {
      operation, code: value.code, message: value.message, retryable: value.retryable,
    } });
  }

  private async start() {
    const execution = this.begin();
    this.update({ phase: 'loading', error: null });
    try {
      const response = await this.api.start(this.creativeId, execution.controller.signal);
      if (!execution.current()) return;
      this.update({
        challengeId: response.challengeId, creative: response.creative,
        loadAttempt: this.state.loadAttempt + 1,
      });
    } catch (error) {
      if (execution.current()) this.failed('start', error);
    } finally {
      if (execution.current()) this.request = null;
    }
  }

  drop = (point: DropPoint) => {
    if (!this.opened || this.state.phase !== 'challenge' || !this.state.challengeId
        || !Number.isFinite(point.dropX) || !Number.isFinite(point.dropY)
        || point.dropX < 0 || point.dropX > 1 || point.dropY < 0 || point.dropY > 1) return;
    const request = Object.freeze({ challengeId: this.state.challengeId, ...point });
    void this.verify(request);
  };

  private async verify(request: VerifyRequest) {
    const execution = this.begin();
    this.update({ phase: 'verifying', lastVerify: request, error: null, notice: null });
    try {
      const response = await this.api.verify(request, execution.controller.signal);
      if (!execution.current()) return;
      if (!response.passed) {
        this.update({ phase: 'challenge', run: this.state.run + 1, notice: 'miss' });
        return;
      }
      this.update({
        phase: 'snapping', run: this.state.run + 1,
        result: {
          challengeId: request.challengeId, creativeId: this.creativeId,
          completionId: response.completionId, clickId: response.clickId,
        },
      });
    } catch (error) {
      if (execution.current()) this.failed('verify', error);
    } finally {
      if (execution.current()) this.request = null;
    }
  }

  assetsReady = (run: number) => {
    if (this.opened && this.state.phase === 'loading' && this.state.challengeId && run === this.state.run) {
      this.update({ phase: 'challenge', error: null, notice: null });
    }
  };

  assetsError = (run: number) => {
    if (this.opened && this.state.phase === 'loading' && run === this.state.run) {
      this.update({ phase: 'error', error: {
        operation: 'assets', code: 'ASSETS', message: '광고 이미지를 불러오지 못했어요.', retryable: true,
      } });
    }
  };

  retry = () => {
    if (!this.opened || this.state.phase !== 'error' || !this.state.error?.retryable) return;
    const operation = this.state.error.operation;
    if (operation === 'start') void this.start();
    else if (operation === 'verify' && this.state.lastVerify) void this.verify(this.state.lastVerify);
    else if (operation === 'assets') {
      this.update({ phase: 'loading', error: null, run: this.state.run + 1, loadAttempt: this.state.loadAttempt + 1 });
    }
  };

  stageEnd = (stage: 'snapping' | 'revealing', run: number) => {
    if (!this.opened || !this.state.result || this.state.phase !== stage || this.state.run !== run) return;
    if (stage === 'snapping') {
      this.update({ phase: 'revealing' });
      return;
    }
    if (this.completionDelivered) return;
    this.completionDelivered = true; // 호스트 재진입/예외 전에 전달을 확정한다.
    const result = { ...this.state.result };
    this.update({ phase: 'completed' });
    this.callbacks?.onComplete(result);
  };

  resize = () => {
    if (this.opened && (this.state.phase === 'snapping' || this.state.phase === 'revealing')) {
      this.update({ phase: 'snapping', run: this.state.run + 1 });
    }
  };
}
