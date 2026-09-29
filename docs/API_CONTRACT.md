# StayPet Backend API Contract v1

상태: **Backend-owned · Frontend integration contract**  
기준일: 2026-09-29  
Base URL: `/api/v1`

이 문서는 Claude Code가 구현하는 frontend와 Codex가 소유하는 backend 사이의 기준이다.
Frontend는 provider 응답, Storage 경로, 파일명 규칙을 추론하지 않고 이 API만 사용한다.

## 1. 공통 규칙

### 인증과 사용자 범위

PoC에서는 모든 요청에 다음 헤더를 보낸다.

```http
Authorization: Bearer <POC_API_TOKEN>
X-StayPet-Owner-Id: 7bf7bb67-fc41-405c-83f2-d0daaf222f52
```

- `POC_API_TOKEN`이 서버에 설정되지 않은 로컬 테스트에서는 Authorization을 생략할 수 있다.
- `X-StayPet-Owner-Id`는 UUID다.
- 이는 최종 인증 제품이 아니다. Supabase JWT 인증으로 교체될 때에도 resource ownership 의미는 유지한다.
- Supabase service-role key와 AI provider key를 frontend에 전달하지 않는다.
- Browser prototype origin은 backend `CORS_ORIGINS` allowlist에 명시한다. wildcard credential CORS를 사용하지 않는다.

### 비동기 생성

생성 POST는 `202 Accepted`와 `GenerationJob`을 즉시 반환한다. Frontend는 job URL을 polling한다.

```text
queued → processing → succeeded
                   ↘ failed
processing → queued  (backend 내부의 재시도 가능한 실패)
```

- 권장 polling: 즉시 1회, 이후 1초 → 2초 → 최대 5초 간격.
- 앱 background에서는 polling을 중지하고 foreground 복귀 시 즉시 조회한다.
- `succeeded`와 `failed`는 terminal이다.
- `failed`에서 사용자가 다시 요청하면 **새 Idempotency-Key**를 사용한다.
- polling 네트워크 실패는 job 실패가 아니다. 동일 job을 다시 조회한다.
- 진행률 퍼센트와 남은 시간은 제공하지 않는다.

### Idempotency-Key

후보 생성 및 asset pack 생성 POST에는 8~160자의 `Idempotency-Key`가 필수다.

- 같은 pet·job type·key 재요청은 기존 job을 반환하고 AI 비용을 중복 발생시키지 않는다.
- candidate와 asset-pack job은 같은 문자열을 사용해도 job type이 달라 충돌하지 않는다.
- 동일 key의 요청 body를 바꾸지 않는다. 실패 후 명시적인 새 시도는 새 key를 사용한다.

### 오류 형식

```json
{
  "error": {
    "code": "source_image_count_invalid",
    "message": "Candidate generation requires 2 to 5 active reference images for this PoC",
    "retriable": false,
    "details": {},
    "request_id": "9883e821-4adf-4f32-8cc0-f0cd4a779ea4"
  }
}
```

Frontend 재시도 원칙:

- `retriable: true`: 같은 조회를 재시도하거나, terminal job이면 사용자의 명시적 재시도에서 새 key 사용.
- `retriable: false`: 입력 수정 또는 사용자 선택이 필요하다.
- `401`: 로컬 PoC token/config 문제. 자동 무한 재시도 금지.
- `404`: 다른 사용자의 resource도 같은 응답으로 숨긴다.
- `409`: 현재 resource 상태가 요청 조건을 만족하지 않는다.
- `422`: body, image 또는 선택 값이 유효하지 않다.

## 2. Resource schemas

### GenerationJob

```json
{
  "id": "9d1aed54-cd42-4ef3-ae24-8e535d063d69",
  "pet_id": "4cf62ccd-9ac3-46c4-ad1e-4e7837708793",
  "canonical_character_id": null,
  "job_type": "candidate_generation",
  "status": "queued",
  "provider": "mock",
  "provider_model": "mock-stylized-real-v1",
  "prompt_version": "candidate-v1",
  "style_version": "stylized-real-v1",
  "config_version": "character-poc-v1",
  "attempt_count": 0,
  "max_attempts": 3,
  "created_at": "2026-09-29T01:00:00Z",
  "started_at": null,
  "completed_at": null,
  "error": null
}
```

Frontend는 provider/model 필드를 표시용 제품 카피로 사용하지 않는다. 기술 진단 및 PoC 기록용이다.

## 3. Endpoints

### `POST /api/v1/pets`

Pet을 만든다.

```json
{
  "name": "보리",
  "species": "dog",
  "appearance_metadata": {
    "coat_color": "cream",
    "ear_color": "light gold"
  }
}
```

응답 `201`:

```json
{
  "id": "4cf62ccd-9ac3-46c4-ad1e-4e7837708793",
  "name": "보리",
  "species": "dog",
  "appearance_metadata": {"coat_color": "cream", "ear_color": "light gold"},
  "created_at": "2026-09-29T01:00:00Z"
}
```

### `POST /api/v1/pets/{pet_id}/source-images`

`multipart/form-data`로 원본 참조 이미지를 backend에 업로드한다.

| field | type | required |
|---|---|---|
| `file` | PNG/JPEG/WebP, 최대 20MB | yes |
| `sort_order` | integer | no, default 0 |

성공 `201`은 `id`, `pet_id`, `media_type`, `byte_size`, `sha256`, `width`, `height`, `sort_order`, `created_at`을 반환한다.
동일 pet에 동일 SHA-256을 다시 올리면 기존 source record를 반환한다.

Terminal errors:

- `404 pet_not_found`
- `409 source_image_limit_reached` — 활성 이미지 5장 초과
- `422 invalid_source_image`

### `GET /api/v1/pets/{pet_id}/source-images`

활성 source images를 `sort_order`, `created_at` 순으로 반환한다. 원본 image URL은 반환하지 않는다.

### `POST /api/v1/pets/{pet_id}/candidate-generation-jobs`

Header: `Idempotency-Key` 필수.

```json
{"candidate_count": 3}
```

- PoC는 후보 2~3개를 허용한다.
- 현재 identity 실험은 활성 reference 2~5장이 필요하다.
- 응답 `202`: `GenerationJob`.

Terminal errors:

- `409 source_image_count_invalid`
- `404 pet_not_found`
- `422 request_validation_failed`

### `GET /api/v1/generation-jobs/{job_id}`

job 상태를 반환한다. 다른 owner의 job은 `404`다.

실패 예:

```json
{
  "status": "failed",
  "error": {
    "code": "provider_http_error",
    "message": "OpenAI Image API error (400)",
    "retriable": false
  }
}
```

### `GET /api/v1/pets/{pet_id}/candidates?generation_job_id={job_id}`

후보 목록을 반환한다. job이 `succeeded`가 된 뒤 호출한다.

```json
[
  {
    "id": "8ddbece5-b3a1-470d-aed2-efba70ceab35",
    "pet_id": "4cf62ccd-9ac3-46c4-ad1e-4e7837708793",
    "generation_job_id": "9d1aed54-cd42-4ef3-ae24-8e535d063d69",
    "candidate_index": 0,
    "image_url": "https://...signed-or-local-url...",
    "media_type": "image/png",
    "width": 1024,
    "height": 1024,
    "created_at": "2026-09-29T01:02:00Z"
  }
]
```

`image_url`은 임시 signed URL일 수 있다. 영구 저장하지 말고 목록을 다시 조회해 갱신한다.

### `POST /api/v1/pets/{pet_id}/canonical-characters`

성공한 후보 하나를 versioned canonical identity로 선택한다.

```json
{
  "candidate_id": "8ddbece5-b3a1-470d-aed2-efba70ceab35",
  "appearance_metadata": {"distinctive_mark": "left ear slightly darker"},
  "corrections": [
    {"field": "ear_color", "from": "gold", "to": "light gold"}
  ]
}
```

응답 `201`:

```json
{
  "id": "9dc15355-f342-4010-9942-679879dd8eea",
  "pet_id": "4cf62ccd-9ac3-46c4-ad1e-4e7837708793",
  "version": 1,
  "selected_candidate_id": "8ddbece5-b3a1-470d-aed2-efba70ceab35",
  "source_image_ids": ["...", "..."],
  "species": "dog",
  "appearance_metadata": {"coat_color": "cream", "distinctive_mark": "left ear slightly darker"},
  "style_version": "stylized-real-v1",
  "provider": "mock",
  "provider_model": "mock-stylized-real-v1",
  "prompt_version": "candidate-v1",
  "config_version": "character-poc-v1",
  "correction_history": [{"field": "ear_color", "from": "gold", "to": "light gold"}],
  "image_url": "https://...signed-or-local-url...",
  "created_at": "2026-09-29T01:04:00Z"
}
```

같은 candidate·appearance metadata·correction history 조합을 다시 보내면 기존 canonical version을 반환한다.
같은 candidate라도 보정 내용이 달라지면 새 canonical version이 만들어진다.

Terminal errors:

- `422 candidate_not_for_pet`
- `409 candidate_job_not_succeeded`

### `GET /api/v1/pets/{pet_id}/canonical-character`

가장 최신 canonical version을 반환한다. 없으면 `404 canonical_character_not_found`.

### `POST /api/v1/canonical-characters/{canonical_id}/asset-pack-generation-jobs`

Header: `Idempotency-Key` 필수.

```json
{}
```

첫 PoC의 pack은 정확히 다음 대표 상태를 모두 생성한다.

```json
["idle", "walk", "sleep", "eat", "play", "pet_positive"]
```

응답 `202`: `GenerationJob`.

### `GET /api/v1/canonical-characters/{canonical_id}/asset-pack`

가장 최신 성공 pack manifest를 반환한다. Frontend는 파일명을 추론하지 않는다.

```json
{
  "manifest_version": "1.0",
  "asset_pack_id": "a4d3c0ed-4017-459b-bfd1-b0641bb7e790",
  "asset_pack_version": 1,
  "canonical_character_id": "9dc15355-f342-4010-9942-679879dd8eea",
  "canonical_version": 1,
  "style_version": "stylized-real-v1",
  "provider": "mock",
  "provider_model": "mock-stylized-real-v1",
  "prompt_version": "asset-pack-v1",
  "config_version": "character-poc-v1",
  "generated_at": "2026-09-29T01:08:00Z",
  "assets": [
    {
      "asset_id": "...",
      "behavior": "idle",
      "orientation": "front_three_quarter",
      "media_type": "image/png",
      "width": 512,
      "height": 512,
      "has_transparency": true,
      "floor_anchor": {"x": 0.5, "y": 0.96},
      "visual_bounds": {"x": 0.04, "y": 0.04, "width": 0.92, "height": 0.92},
      "source_generation_job_id": "...",
      "generation_metadata": {"mock": true},
      "download_url": "https://...signed-or-local-url..."
    }
  ]
}
```

아직 완료 pack이 없으면 `404 asset_pack_not_ready`, `retriable: true`다. 정상 흐름은 먼저 job을 polling한다.

## 4. Mock와 real provider의 계약

- `GENERATION_PROVIDER=mock`와 `GENERATION_PROVIDER=openai`는 위 API를 동일하게 사용한다.
- Frontend는 provider별 분기 코드를 만들지 않는다.
- Mock image의 시각 품질은 평가 대상이 아니다. 화면 흐름·polling·오류·manifest 연결용이다.
- provider 변경은 후보와 asset의 `provider`, `provider_model`, `generation_metadata`에만 드러난다.

## 5. API 변경 요청

Frontend에서 계약 변경이 필요하면 [API_CHANGE_REQUESTS.md](./API_CHANGE_REQUESTS.md)에 요청한다.
Backend가 수용한 뒤 이 문서의 versioned contract를 먼저 수정한다.
