# StayPet Backend Status

최종 갱신: 2026-09-29  
소유자: Codex / Backend + AI Generation

## 현재 상태

**FRONTEND MOCK INTEGRATION READY**

Identity-preserving character generation PoC의 mock vertical slice가 구현·검증됐다.

```text
Pet 생성
→ source images 2~5장 upload
→ candidate generation job
→ worker queued/processing/succeeded
→ candidate 2~3개 조회
→ canonical character version 선택/보존
→ representative asset-pack job
→ 6개 상태 asset + manifest 조회
```

`lowfi/`, `hifi/`는 수정하지 않았다.

## 구현된 backend

- FastAPI `/api/v1` resource API
- SQLite local test/runtime adapter + Supabase Postgres migration
- local object storage + private Supabase Storage adapter
- API process와 분리된 polling worker
- `queued / processing / succeeded / failed`
- transient retry, exponential backoff, terminal error persistence
- `(pet_id, job_type, idempotency_key)` 중복 생성 방지
- source → job → candidate → canonical version → pack → asset lineage
- Mock provider
- OpenAI Image API provider adapter
- asset 기술 QA 및 manifest validation
- identity PoC CSV/JSON evaluation export
- PoC bearer token 및 owner scoping

## Frontend가 사용할 문서

1. [API_CONTRACT.md](./API_CONTRACT.md)
2. [CHARACTER_ASSET_SPEC.md](./CHARACTER_ASSET_SPEC.md)
3. 변경 필요 시 [API_CHANGE_REQUESTS.md](./API_CHANGE_REQUESTS.md)

Frontend는 provider 종류, Storage path 또는 filename을 분기하지 않는다.

## 로컬 mock 실행

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -e '.[test]'
cp .env.example .env
.venv/bin/uvicorn app.main:app --reload
```

별도 terminal:

```bash
cd backend
.venv/bin/python -m app.worker
```

필수 frontend request headers:

```http
Authorization: Bearer <POC_API_TOKEN>
X-StayPet-Owner-Id: <UUID>
```

## 검증 결과

- Python compile: PASS
- Automated backend tests: **11 passed**
- Complete mock vertical slice: PASS
- Mock queued → processing → transient retry → success: PASS
- Permanent provider failure → terminal failed: PASS
- Candidate/canonical/asset lineage: PASS
- OpenAI adapter request-shape unit test: PASS

테스트 명령:

```bash
backend/.venv/bin/pytest backend/tests -q
```

## Real provider 상태

구현: **완료**  
실제 API 호출 검증: **대기**

- 공식 OpenAI Image API 문서를 확인해 multi-reference `images.edit` 흐름으로 구현했다.
- 기본 모델 설정은 `gpt-image-2.5-sunburst`, high quality, transparent PNG다.
- API key가 없어 실제 후보/asset 생성과 비용·latency 측정은 실행하지 않았다.
- 실제 호출은 `OPENAI_API_KEY`와 해당 조직의 GPT Image 접근 조건이 준비된 뒤 수행한다.

## Supabase 상태

Schema/Storage migration: **작성 완료**  
실제 Supabase project 적용: **대기**

- migration: `backend/supabase/migrations/202609290001_character_generation_poc.sql`
- private bucket: `staypet-assets`
- frontend direct DB/Storage policy 없음
- server-side service role만 사용
- 실제 project credentials가 없어 migration과 signed URL을 live 검증하지 않았다.

## Identity PoC 평가 상태

- 평가 지표 및 초기 가설: 작성 완료
- 기술 job export 도구: 구현 완료
- 실제 반려동물 sample 평가: 미실행
- 사람의 likeness/정체성 검토: 미실행
- cost/latency: 실공급자 실행 전이므로 미측정

## 현재 blocker

Mock frontend integration blocker: **없음**

Real identity experiment에는 다음 외부 상태가 필요하다.

1. OpenAI API key 및 GPT Image 사용 가능한 조직
2. 동의받은 반려동물 reference 2~5장
3. Supabase project URL, Postgres URL, server-only service-role key

이 blocker는 mock API 연동을 막지 않는다.

## Claude Code handoff

Claude Code는 다음만 진행한다.

- source upload UI를 `POST /pets/{id}/source-images`에 연결
- job 생성 후 `GET /generation-jobs/{id}` polling
- succeeded 뒤 candidates 조회·비교
- canonical selection POST
- asset job polling 뒤 manifest 조회
- manifest `behavior + orientation`으로 asset 소비
- mock/real provider 분기 없음

Backend 계약 변경이 필요하면 `API_CHANGE_REQUESTS.md`에 먼저 기록한다.

## 다음 backend milestone

1. Claude frontend의 mock 연동 요청 대응
2. Supabase migration/storage live smoke test
3. OpenAI 실공급자로 첫 2~3 candidate batch 생성
4. 사람이 canonical 선택
5. 6상태 asset pack 생성
6. latency, retry, usage, cost와 human identity review 기록
