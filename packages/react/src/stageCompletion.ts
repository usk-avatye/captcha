export type StageCompletion = {
  finish: (eventTimeStamp?: number) => void;
  cancel: () => void;
};

// 전환 이벤트와 우회 타이머가 같은 완료 함수를 사용한다.
export function armStageCompletion(
  durationMs: number,
  onComplete: () => void,
): StageCompletion {
  let active = true;
  const notBefore = performance.now() + durationMs;
  const finish = (eventTimeStamp?: number) => {
    if (!active || (eventTimeStamp !== undefined && eventTimeStamp < notBefore)) return;
    active = false;
    clearTimeout(timer);
    onComplete();
  };
  const timer = setTimeout(finish, durationMs === 0 ? 0 : durationMs + 100);

  return {
    finish,
    cancel() {
      active = false;
      clearTimeout(timer);
    },
  };
}
