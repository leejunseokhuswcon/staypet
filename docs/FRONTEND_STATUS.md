# StayPet Frontend Status

최종 갱신: 2026-09-29
소유자: Claude Code / Frontend
Backend 계약 기준: [API_CONTRACT.md](./API_CONTRACT.md) v1, [CHARACTER_ASSET_SPEC.md](./CHARACTER_ASSET_SPEC.md) v1

## 현재 milestone

**첫 AI 연동 vertical slice — mock backend 연동 완료**

```text
종·이름·성별 → 사진 2~5장 → (확정 시 업로드) → 후보 생성 job → 준비 중(polling)
→ 후보 2~3개 비교·선택 → (선택) 조금 다른 점 알려 주기 → canonical 확정(backend)
→ asset-pack job → 준비 중(polling) → manifest → 첫 만남 → Home(생성 캐릭터 렌더링)
```

실공급자(OpenAI) 연동 테스트: **대기** — backend가 실공급자 준비 완료를 표시하면 같은 코드로 진행한다(provider 분기 없음).

## 이번 slice의 결정 (사용자 확인, 2026-09-29)

| 주제 | 결정 | 이유 |
|---|---|---|
| 생활 문답 Q1 | **이번 slice에서 보류.** Home은 기존 프로토타입의 고정 선호 부위를 유지 | milestone flow에 Q1이 없고 backend에 저장 위치가 없음 → ACR-02 |
| 사진 업로드 시점 | **`이 사진으로 계속`에서 업로드.** 그 전까지 사진은 기기에만 있고 빼기·바꾸기가 자유로움 | source image 삭제 endpoint가 없음 → ACR-01 |
| 보정 | **"조금 다른 점 알려 주기" 메모** (얼굴·귀 모양 / 털색·무늬). 이미지는 그대로이고 생활 모습 준비에 참고된다고 정직하게 안내 | backend는 보정을 메타데이터로 기록만 함 → ACR-04 |
| 사진 수 | **2~5장** (UX_FINAL의 "최소 1장"보다 이 milestone 지시와 API 계약이 우선) | API 계약 |

## 연동된 backend endpoint

| Endpoint | 사용하는 곳 |
|---|---|
| `POST /pets` | 사진 확정 시 (그 전에는 아무것도 backend로 보내지 않음) |
| `POST /pets/{id}/source-images` | 사진 확정 시 사진별 업로드, 사진별 재시도 |
| `POST /pets/{id}/candidate-generation-jobs` | 후보 생성. 새로 시도할 때마다 새 Idempotency-Key, 새로고침 중 재전송이면 같은 key |
| `GET /generation-jobs/{id}` | polling (후보·asset-pack 공용) |
| `GET /pets/{id}/candidates?generation_job_id=` | 후보 표시. URL은 저장하지 않고 매번 새로 조회 |
| `POST /pets/{id}/canonical-characters` | 선택 확정. 응답이 와야 다음 단계로 넘어감 |
| `GET /pets/{id}/canonical-character` | 재진입 시 backend의 canonical을 기준으로 확인 |
| `POST /canonical-characters/{id}/asset-pack-generation-jobs` | 생활 모습 pack 요청 |
| `GET /canonical-characters/{id}/asset-pack` | manifest → 첫 만남 · Home 렌더링 |

아직 쓰지 않는 endpoint: `GET /pets/{id}/source-images` (원본 URL이 없어 화면에 쓸 곳이 없음).

## Mock / fixture 상태

- **frontend fixture 없음.** 모든 화면이 실제 backend(mock provider)를 호출한다.
- mock과 real provider를 가르는 UI 코드는 없다. `provider`, `provider_model`, `generation_metadata`는 읽지 않는다.
- 브라우저 localStorage에는 **ID와 입력 초안만** 둔다 (`staypet.creation.v1`, `staypet.owner`, `staypet.api`). URL과 canonical 결정은 저장하지 않는다.

## Frontend 구조

```text
hifi/
  api/config.js        base URL · PoC token · owner id (query → localStorage → 기본값)
  api/client.js        transport, 계약의 오류 형식 → ApiError(status, code, retriable)
  api/staypet.js       endpoint별 함수 (UI는 fetch를 직접 부르지 않음)
  api/poll.js          watchJob / JobWatchSlot — 0→1→2→3→5s, 숨김 시 멈춤, terminal에서 정지
  character/manifest.js  manifest v1 파싱, behavior+orientation 조회, floor_anchor 배치 계산
  character/render.js    pack → .pet 슬롯 이미지 (idle·walk·sleep·eat·play·pet_positive)
  create/session.js    재진입용 ID·초안
  create/josa.js       이름 조사 (보리가 / 콩이)
  create.html · create.css · create.js   생성 flow 화면
  home-character.js    Home: canonical이 있으면 manifest를 불러 placeholder를 교체
  tests/               node --test 단위 테스트
```

기존 High-fi(`index.html`, `app.js`, `styles.css`)의 변경은 최소로 했다.
- `app.js`: 캐릭터 이벤트를 받아 SVG 대신 생성 이미지를 쓰는 hook, 이름 조사 helper. 생활 루프·쓰다듬기 zone·경제·튜토리얼·배치는 **변경 없음**.
- `styles.css`: 생성 캐릭터 슬롯 CSS 한 블록 (기존 `data-act` 상태로 보이는 이미지를 고름).
- `index.html`: 캐릭터를 불러오는 동안 placeholder를 숨기는 head script, `home-character.js`, 빈 favicon.

## 실패 · 재시도 동작

| 상황 | 보이는 것 | 보존되는 것 |
|---|---|---|
| 형식·용량이 맞지 않는 파일 | 해당 사진 위에 이유 + `바꾸기` | 다른 사진 |
| 사진 하나 업로드 실패 | 그 사진만 `올리지 못했어요 · 다시 올리기` | 이미 올린 사진 |
| backend가 사진을 거부 (422) | `이 사진은 열 수 없었어요 · 바꾸기` | 다른 사진 |
| 같은 사진을 두 번 고름 | `이미 고른 사진이에요` | — |
| polling 요청 실패 | 3회 연속 실패부터 `연결이 잠시 끊겼어요…` 안내, 같은 job 계속 조회 | job |
| backend 내부 재시도 (processing → queued) | `조금 더 걸리고 있어요` | job |
| 후보 job 실패 | `모습을 준비하지 못했어요` + `다시 시도`(새 key) / `사진 더하기` / `이전 모습 다시 보기` | 사진·정보·이전 후보 |
| 두 번 이상 실패 | 다른 각도의 사진을 더하라는 안내 추가 | 동일 |
| 후보 이미지 로드 실패 | 그 모습만 `다시 불러오기` (목록을 새로 받아 URL 갱신) | 선택 |
| canonical 저장 실패 | CTA 아래 안내, 다시 누르면 재시도 (backend가 fingerprint로 중복 제거) | 선택 |
| asset-pack 실패 | `다시 시도`(새 key) | canonical |
| 401 | `연결 설정을 확인해 주세요` (로컬 token 문제, 자동 재시도 없음) | 전부 |

사용자에게 기술 용어(모델, job, provider, 오류 코드)는 보이지 않는다.

## 테스트

### 단위 (`cd hifi && node --test tests/`) — 19 pass
- polling: 즉시 조회와 backoff, 성공·실패 시 정지, 네트워크 실패 재시도, non-retriable 시 reject, stop() 후 늦은 응답 무시, 숨김 중 멈춤과 복귀 즉시 조회, slot 하나에 loop 하나
- client: 헤더(owner·bearer·idempotency), multipart, 오류 envelope 변환, 네트워크 오류, 5xx
- manifest: v1 파싱, major version 거부, 잘못된 asset 제외, floor anchor 배치, idle fallback 렌더링, 조사

### 브라우저 E2E (headless Chrome, 실제 mock backend + worker)
2026-09-29 실행 결과:
- 정상 경로 전체: 390×844, console error 0, job당 poll 3회(1s→2s 간격), backend canonical id와 선택 후보 일치, Home에 생성 idle asset 렌더링
- 실패·재시도·재진입 19항목 PASS: 파일 거부, 사진 빼기 되돌리기, 업로드 1장 실패 후 그 사진만 재시도, 영구 실패 job(실제 `GenerationWorker` + 항상 실패하는 provider), 실패 후 polling 정지, 새 key로 재시도, 사진 재업로드 없음, 후보 화면 새로고침 복원, `그만 보기` 뒤 재진입 시 자동 노출 없음, polling 네트워크 끊김을 job 실패로 오인하지 않음, 대기 중 새로고침 시 같은 job을 loop 하나로 이어서 조회, 보정 메모가 backend canonical에 기록됨, pack 대기 중 새로고침 뒤 첫 만남 도달, 생성 캐릭터로 확대·선호 부위 쓰다듬기 하트 정상
- 모바일: 360×740 / 390×844 / 430×932에서 가로 넘침 없음, 44px 미만 터치 대상 없음, 후보 비교 썸네일이 CTA에 가려지지 않음
- 회귀: 생성 pet이 없는 Home은 기존 SVG 보리와 문구 그대로

E2E 스크립트는 저장소 밖(세션 scratchpad)에서 `playwright-core` + 시스템 Chrome으로 실행했다. 저장소에는 아직 E2E runner가 없다.

## 로컬 실행

```bash
# 1) backend (Codex 문서 기준) — 별도 terminal 2개
cd backend && .venv/bin/uvicorn app.main:app --port 8000
cd backend && .venv/bin/python -m app.worker
#   준비 중 화면을 보려면 backend/.env 에 MOCK_GENERATION_DELAY_MS=2500 정도를 권장

# 2) frontend — CORS allowlist(127.0.0.1:3000)에 맞춰 3000번에서 제공
cd hifi && python3 -m http.server 3000 --bind 127.0.0.1

# 3) 처음 한 번: backend 주소와 로컬 PoC token 전달 (localStorage에 저장되고 URL에서 지워짐)
open "http://127.0.0.1:3000/create.html?api=http://127.0.0.1:8000/api/v1&token=<POC_API_TOKEN>"
```

## 테스트 경로

| 경로 | 용도 |
|---|---|
| `create.html` | 생성 flow. 진행 상태에 맞는 화면에서 이어짐 |
| `create.html?reset=1` | 이 브라우저의 생성 진행을 지우고 새 pet으로 시작 (진행자용) |
| `create.html?api=…&token=…` | backend 연결 설정 |
| `index.html` | Home. canonical pet이 있으면 생성 캐릭터, 없으면 기존 placeholder |
| `index.html?hearts=N` | 기존 디자인 리뷰용 하트 fixture (변경 없음) |

## 알려진 UX 이슈 / 한계

1. **Q1 보류**: 생성 pet도 Home의 고정 선호 부위(머리)를 쓴다. UX_FINAL의 Q1 위치와 다르며 사용자 결정으로 보류했다 (ACR-02 이후 재개).
2. **올린 사진은 잠김**: 확정 뒤에는 사진을 빼거나 바꿀 수 없고 더하기만 된다 (ACR-01).
3. **확정 전 새로고침**: 아직 올리지 않은 사진은 브라우저 메모리에만 있어서 새로고침하면 사라진다. 올린 사진은 새로고침 뒤 미리보기 없이 `업로드 완료` 칸으로 보인다 (원본 URL을 받지 않는 계약).
4. **`기본 정보 확인` 경로 없음**: `다시 준비하기`에는 `사진 더하기` / `같은 사진으로 새 모습 받기`만 있다. pet 수정 endpoint가 없음 (ACR-02).
5. **재진입은 같은 브라우저에서만** (ACR-03).
6. **첫 만남 앞 단계 생략**: 공간 사진·이동 영역은 이번 범위가 아니다. 첫 만남은 프로토타입 방을 쓴다.
7. **움직임**: 생성 pack은 상태별 정지 이미지 6장이라 걷기는 이미지 교체 + 약한 몸 흔들림으로만 표현된다. 오른쪽 이동은 기존 `.pet-flip` 좌우 반전을 쓴다 (spec상 PoC 검증 항목).
8. **floor anchor**: mock pack의 `floor_anchor.y=0.96`은 임시값이라 mock 이미지에서는 발과 그림자 사이가 조금 뜬다. frontend는 manifest 값을 그대로 쓴다.
9. **mock 이미지 품질**은 평가 대상이 아니다 (API_CONTRACT §4).
10. 생성 캐릭터의 `pet_positive` 반응은 reduced-motion 설정에서 보이지 않는다 (반응 문구는 그대로 나옴).

## Backend 의존성

- 실공급자 준비 완료 표시 → 같은 flow로 실공급자 테스트, 대기 시간이 길 때의 준비 중 화면 검증
- ACR-01 ~ 04 결정
- 실제 인증 도입 시 `X-StayPet-Owner-Id`/PoC token 대신 JWT (`api/client.js` 한 곳만 바뀜)

## 다음 frontend milestone (제안)

1. 실공급자 결과로 후보 비교 화면 검증 (큰 해상도, 실제 닮음 비교, 긴 대기)
2. ACR-01/02 반영: 사진 바꾸기, Q1(선호 부위)을 생성 대기 앞에 넣고 Home 쓰다듬기 zone에 연결
3. 로그인 · 공간 사진 · 이동 영역을 High-fi로 만들고 첫 만남 앞에 연결
4. E2E runner를 저장소에 둘지 결정 (현재는 저장소 밖에서 실행)
