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
      <a className="community-logo" href="/" aria-label="라운지 커뮤니티 처음으로">라운지</a>
      <div className="community-balance">
        <span>모의 포인트</span>
        <output data-points aria-label="모의 포인트" aria-live="polite">{community.points}P</output>
      </div>
    </header>
    <main className="community-main">
      <div className="community-heading">
        <h1 id="composer-heading">글쓰기</h1>
      </div>
      <div className="community-layout">
        <div className="community-primary">
          {community.registered
            ? <section className="publish-confirmation" aria-label="글 등록 완료">
                <span className="confirmation-mark" aria-hidden="true">✓</span>
                <h2 ref={confirmation} tabIndex={-1}>등록 완료</h2>
                <button className="primary-button" type="button" onClick={community.newPost}>새 글 쓰기 <span aria-hidden="true">＋</span></button>
              </section>
            : <section className="composer-card" aria-labelledby="composer-heading">
                <form onSubmit={event => { event.preventDefault(); community.requestPublish(); }}>
                  <div className="composer-field">
                    <label htmlFor="post-title">제목</label>
                    <input ref={titleInput} id="post-title" name="title" required
                      value={community.draft.title} onChange={event => community.updateDraft('title', event.target.value)}
                      aria-invalid={!!community.error}
                      aria-describedby={community.error ? 'draft-error' : undefined} />
                  </div>
                  <div className="composer-field">
                    <label htmlFor="post-body">본문</label>
                    <textarea id="post-body" name="body" required rows={9}
                      value={community.draft.body} onChange={event => community.updateDraft('body', event.target.value)}
                      aria-invalid={!!community.error} aria-describedby={community.error ? 'draft-error' : undefined} />
                  </div>
                  {community.error && <p className="form-error" id="draft-error" role="alert">{community.error}</p>}
                  <div className="composer-footer">
                    <button className="primary-button" type="submit">
                      등록
                    </button>
                  </div>
                </form>
              </section>}
          <section className="community-posts" aria-labelledby="posts-heading">
            <div className="posts-heading"><h2 id="posts-heading">내 글</h2><span>{community.posts.length}개</span></div>
            {community.posts.length === 0
              ? <p className="empty-posts">등록한 글이 없습니다.</p>
              : community.posts.map(post => <article className="community-post" key={post.number}>
                  <div className="post-meta"><span className="post-avatar" aria-hidden="true">L</span><span>나</span><span>#{post.number}</span></div>
                  <h3>{post.title}</h3>
                  <p className="post-body">{post.body}</p>
                </article>)}
          </section>
        </div>
      </div>
    </main>
    <CaptchaModal key={community.attemptKey} open={community.open} creativeId="bmw-m3-v1"
      onComplete={community.onComplete} onContinue={community.onContinue} onClose={community.onClose} />
  </>;
}
