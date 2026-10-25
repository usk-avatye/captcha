import { useEffect, useRef } from 'react';
import { CaptchaModal } from '../sdk/captchavatye';
import { useCommunityDraft } from './useCommunityDraft';

export function DemoCommunityPage() {
  const community = useCommunityDraft();
  const titleInput = useRef<HTMLInputElement>(null);
  const confirmation = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (community.registered) confirmation.current?.focus();
  }, [community.registered]);
  useEffect(() => {
    if (community.attemptKey > 0) titleInput.current?.focus();
  }, [community.attemptKey]);

  return <>
    <header className="community-header">
      <a className="community-logo" href="/" aria-label="라운지 커뮤니티 처음으로">라운지<span>LOUNGE</span></a>
      <span className="community-nav">이야기가 모이는 곳</span>
      <div className="community-balance">
        <span>내 모의 포인트</span>
        <output data-points aria-label="모의 포인트" aria-live="polite">{community.points}P</output>
      </div>
    </header>
    <main className="community-main">
      <div className="community-heading">
        <div><span className="eyebrow">COMMUNITY</span><h1>오늘의 이야기를 남겨보세요.</h1></div>
        <span className="demo-chip">시연용 커뮤니티</span>
      </div>
      <div className="community-layout">
        <div className="community-primary">
          {community.registered
            ? <section className="publish-confirmation" aria-label="글 등록 완료">
                <span className="confirmation-mark" aria-hidden="true">✓</span>
                <h2 ref={confirmation} tabIndex={-1}>게시글이 등록됐어요</h2>
                <p>작성한 이야기를 아래에서 확인할 수 있어요.</p>
                <button className="primary-button" type="button" onClick={community.newPost}>새 글 쓰기 <span aria-hidden="true">＋</span></button>
              </section>
            : <section className="composer-card" aria-labelledby="composer-heading">
                <div className="composer-topline"><h2 id="composer-heading">글쓰기</h2><span>자유 이야기</span></div>
                <form onSubmit={event => { event.preventDefault(); community.requestPublish(); }}>
                  <div className="composer-field">
                    <label htmlFor="post-title">제목</label>
                    <input ref={titleInput} id="post-title" name="title" required
                      value={community.draft.title} onChange={event => community.updateDraft('title', event.target.value)}
                      placeholder="어떤 이야기를 나누고 싶나요?" aria-invalid={!!community.error}
                      aria-describedby={community.error ? 'draft-error' : undefined} />
                  </div>
                  <div className="composer-field">
                    <label htmlFor="post-body">본문</label>
                    <textarea id="post-body" name="body" required rows={9}
                      value={community.draft.body} onChange={event => community.updateDraft('body', event.target.value)}
                      placeholder="기억에 남은 드라이브, 궁금한 자동차 이야기… 편하게 남겨주세요."
                      aria-invalid={!!community.error} aria-describedby={community.error ? 'draft-error' : undefined} />
                  </div>
                  {community.error && <p className="form-error" id="draft-error" role="alert">{community.error}</p>}
                  {community.completed && <p className="draft-complete" role="status">✓ 인증 완료 · 모의 10P가 반영됐어요. 글 등록을 이어갈 수 있어요.</p>}
                  <div className="composer-footer">
                    <p>글 등록 전 짧은 인증을 진행해요.<br />닫았다 열어도 작성 중인 글은 유지됩니다.</p>
                    <button className="primary-button" type="submit">
                      {community.completed ? '인증 결과 이어보기' : '인증하고 등록하기'}<span aria-hidden="true">→</span>
                    </button>
                  </div>
                </form>
              </section>}
          <section className="community-posts" aria-labelledby="posts-heading">
            <div className="posts-heading"><h2 id="posts-heading">내가 등록한 글</h2><span>{community.posts.length}개</span></div>
            {community.posts.length === 0
              ? <p className="empty-posts">아직 등록한 글이 없어요. 첫 이야기를 남겨보세요.</p>
              : community.posts.map(post => <article className="community-post" key={post.number}>
                  <div className="post-meta"><span className="post-avatar" aria-hidden="true">L</span><span>나의 이야기</span><span>#{post.number}</span></div>
                  <h3>{post.title}</h3>
                  <p className="post-body">{post.body}</p>
                </article>)}
          </section>
        </div>
        <aside className="community-aside">
          <section className="reward-card" aria-labelledby="reward-heading">
            <span className="reward-symbol" aria-hidden="true">P</span>
            <span className="eyebrow">A LITTLE THANK YOU</span>
            <h2 id="reward-heading">작은 참여에<br />작은 혜택을.</h2>
            <p>리어램프를 제자리에 맞추고<br />모의 포인트 <strong>10P</strong>를 받아보세요.</p>
            <ol>
              <li><span>01</span>글을 작성하고 인증 열기</li>
              <li><span>02</span>램프를 맞추고 10P 받기</li>
              <li><span>03</span>계속하기로 글 등록 마치기</li>
            </ol>
            <p className="reward-optional">시승 신청은 선택 사항이에요.<br />참여하지 않아도 포인트와 글 등록은 완료됩니다.</p>
          </section>
          <p className="community-disclaimer">글과 포인트는 이 페이지에서만 유지되며 새로고침하면 초기화됩니다. 실제 보상이나 예약이 발생하지 않는 시연입니다.</p>
        </aside>
      </div>
    </main>
    <footer className="community-site-footer"><span>LOUNGE × CAPTCHAvatye</span><span>작성을 멈추지 않는 인증 경험</span></footer>
    <CaptchaModal key={community.attemptKey} open={community.open} creativeId="bmw-m3-v1"
      onComplete={community.onComplete} onContinue={community.onContinue} onClose={community.onClose} />
  </>;
}
