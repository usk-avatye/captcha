export type NormalizedRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type VisualPhase =
  | 'loading'
  | 'challenge'
  | 'verifying'
  | 'snapping'
  | 'revealing'
  | 'completed'
  | 'error';

export type Creative = {
  creativeId: string;
  version: string;
  imageUrl: string;
  coverUrl: string;
  pieceUrl: string;
  sourceWidth: number;
  sourceHeight: number;
  lampRect: NormalizedRect;
  zoomRect: NormalizedRect;
  brandTitle: string;
  tagline: string;
  ctaLabel: string;
  landingPath: string;
  snapMs: number;
  revealMs: number;
};

export type RasterCrop = {
  canvasWidth: number;
  canvasHeight: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type DropPoint = { dropX: number; dropY: number };
export type VerifyRequest = DropPoint & { challengeId: string };
export type VerifyResult =
  | { passed: false }
  | { passed: true; completionId: string; clickId: string };
export type ChallengeResponse = { challengeId: string; creative: Creative };
export type CompletionResult = {
  challengeId: string; creativeId: string; completionId: string; clickId: string;
};
export type FlowError = {
  operation: 'start' | 'assets' | 'verify';
  code: string;
  message: string;
  retryable: boolean;
};

export type CaptchaModalProps = {
  open: boolean;
  creativeId: string;
  /** 고객사 서버가 발급한 인증. 시도 변경은 React key로 구분한다. */
  challenge?: ChallengeResponse;
  apiBaseUrl?: string;
  /** 상대 소재 URL을 해석할 절대 HTTP(S) 주소. 기본값은 현재 origin. */
  assetBaseUrl?: string;
  /** 상대 시승 URL을 해석할 절대 HTTP(S) 주소. 기본값은 현재 origin. */
  landingBaseUrl?: string;
  continueLabel?: string;
  onComplete: (result: CompletionResult) => void;
  onContinue: () => void;
  onClose: () => void;
};
