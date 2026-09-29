# StayPet AI Generation Pipeline

상태: Backend PoC v1  
소유자: Codex / backend

## 목적

이 파이프라인은 “이미지 한 장 생성”이 아니라 다음 계보를 보존한다.

```text
Pet
  → 2~5 source references
  → candidate generation job
  → 2~3 candidates
  → user-selected canonical character vN
  → asset-pack generation job
  → reusable Character Asset Pack vN
```

정체성 일치를 보장한다고 주장하지 않는다. 같은 입력·선택·모델·프롬프트·보정 이력으로 결과를 추적하고 다시 평가할 수 있는 안정적인 anchor를 만든다.

## 모듈 경계

| 모듈 | 책임 |
|---|---|
| FastAPI | resource ownership, upload, job enqueue, polling, canonical selection, manifest delivery |
| Postgres | lineage, version, 상태, idempotency, 오류와 provider metadata |
| Private Storage | 원본, 후보, canonical 복사본, asset, manifest |
| Worker | queued job claim, provider 호출, retry, persistence, validation |
| Provider adapter | provider 전용 request/response 형식 격리 |
| Asset validator | 이미지 판독, 크기, alpha, 대표 상태, anchor, manifest 계보 검사 |
| Evaluation export | 기술 지표와 human review용 CSV/JSON 생성 |

## Job 처리

1. API가 입력 snapshot과 `queued` job을 transaction으로 저장한다.
2. 별도 worker가 `FOR UPDATE SKIP LOCKED` 의미로 due job 하나를 claim한다.
3. 상태를 `processing`, attempt를 +1 한다.
4. provider adapter를 호출한다.
5. 파일 검사 후 Storage에 업로드하고 DB lineage를 저장한다.
6. 성공하면 `succeeded`; 재시도 가능한 실패는 exponential backoff 뒤 `queued`; 한도 초과 또는 영구 실패는 `failed`다.

Worker는 FastAPI process 내부 BackgroundTask가 아니다. API 재시작과 요청 lifecycle에서 분리된다.

## Idempotency

DB unique key: `(pet_id, job_type, idempotency_key)`.

- 네트워크 타임아웃 뒤 같은 요청을 반복해도 같은 job을 받는다.
- worker retry는 동일 job ID와 lineage를 유지한다.
- retry 전에 같은 job의 부분 Storage prefix와 DB 결과를 정리한다.
- terminal failure 뒤 사용자가 새로 시도할 때는 새 key를 사용한다.

## Provider interface

```python
class ImageGenerationProvider:
    def generate_candidates(...): ...
    def generate_character_assets(...): ...
```

`mock`와 `openai`가 같은 interface를 구현한다. OpenAI adapter는 현재 공식 OpenAI Image API의 multi-image reference edit 흐름을 사용하며 provider 객체는 adapter 밖으로 나오지 않는다.

현재 기본 실모델 후보는 `gpt-image-2.5-sunburst`다. 모델명은 환경 변수로 versioned job metadata에 저장한다. 모델 교체가 API 계약을 바꾸지 않는다.

## Prompt/version 관리

- `style_version = stylized-real-v1`
- `candidate_prompt_version = candidate-v1`
- `asset_prompt_version = asset-pack-v1`
- `config_version = character-poc-v1`

프롬프트의 목표:

- 종·얼굴 비율·귀·주둥이·눈 위치·털색·무늬·특징 유지
- 반실사/stylized-real 2.5D
- generic breed, cartoon, plush, chibi 억제
- 전체 몸, 일관된 카메라 높이와 scale, 투명 배경

## Storage layout

```text
pets/{pet_id}/source/{source_image_id}.{ext}
pets/{pet_id}/candidates/{job_id}/{candidate_id}.png
pets/{pet_id}/canonical/v0001/canonical.png
pets/{pet_id}/assets/v0001/{behavior}-{orientation}-{asset_id}.png
pets/{pet_id}/assets/v0001/manifest.json
```

버킷은 private다. Frontend에는 짧은 signed URL만 전달한다. service-role과 provider key는 server에만 둔다.

## 삭제 가능성

Pet 삭제 시 DB foreign keys는 source/job/candidate/canonical/pack/asset lineage를 cascade할 수 있다.
Storage는 `pets/{pet_id}/` prefix 하나로 원본과 파생물을 모두 제거할 수 있다.

PoC에는 사용자-facing 삭제 endpoint가 아직 없지만 구조상 삭제를 막는 provider filename이나 flat bucket을 사용하지 않는다. 실공급자가 reference file을 별도로 보존하는 경우 provider-side deletion/retention 확인이 출시 전에 필요하다.

## 실제 공급자 제한

- 참조 이미지 생성은 정체성 유지 보장이 아니다.
- 투명 배경 요청이 항상 완전한 alpha/matting을 보장하지 않는다.
- 동일 canonical에서 생성해도 상태별 특징이 drift할 수 있다.
- API 조직 검증 또는 모델 접근 권한이 필요할 수 있다.
- 감정적 유사도는 자동 검사가 판정하지 않는다.

공식 OpenAI 근거: [Image generation guide](https://developers.openai.com/api/docs/guides/image-generation).
