"""서버 실행 동안 고정되는 소재. 실측 근거: docs/assets/asset-manifest.json."""
from app.schemas.captcha import Creative, NormalizedRect

CREATIVE = Creative(
    creativeId="bmw-m3-v1", version="1",
    imageUrl="/creatives/bmw-m3/vehicle.webp",
    coverUrl="/creatives/bmw-m3/socket-cover.png",
    pieceUrl="/creatives/bmw-m3/lamp.png",
    sourceWidth=1672, sourceHeight=941,
    lampRect=NormalizedRect(x=347 / 1672, y=373 / 941, width=223 / 1672, height=70 / 941),
    zoomRect=NormalizedRect(x=0.13422248803827747, y=0.29358129649309245, width=0.28, height=0.28),
    brandTitle="BMW M3", tagline="Sheer Driving Pleasure",
    ctaLabel="시승 신청", landingPath="/demo/test-drive", snapMs=180, revealMs=650,
)

# 원본 223×70px 램프의 중심 부근을 맞추되 손 조작의 작은 오차를 허용한다.
# 공개 Creative 응답에는 포함하지 않는다.
TOLERANCE_X = 12 / 1672
TOLERANCE_Y = 8 / 941

