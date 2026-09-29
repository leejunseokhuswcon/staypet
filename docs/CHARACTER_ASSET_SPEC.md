# StayPet Character Asset Pack Specification v1

상태: PoC contract  
소유자: Codex / backend  
소비자: Claude Code / frontend

## 1. 목적

Frontend는 provider URL이나 파일명 규칙을 추론하지 않고 manifest만으로 캐릭터 asset을 찾고 배치한다.

첫 PoC는 3D rig나 완성 애니메이션 포맷이 아니다. 동일 canonical identity로 생성된 대표 상태 6개의 provider-independent 2.5D image pack이다.

## 2. 필수 상태

| behavior | orientation | 의미 |
|---|---|---|
| `idle` | `front_three_quarter` | 기본 대기 |
| `walk` | `left_side` | 걷기 대표 자세 |
| `sleep` | `left_three_quarter` | 자율 수면 |
| `eat` | `left_three_quarter` | 밥그릇 쪽으로 머리를 내린 자세 |
| `play` | `left_three_quarter` | 놀이에 반응하는 자세 |
| `pet_positive` | `front_three_quarter` | 선호 부위 쓰다듬기 긍정 반응 |

오른쪽 이동은 PoC에서 frontend mirror 가능 여부를 별도로 검증한다. 이것은 최종 아트 정책이 아니다.

## 3. Manifest

Manifest 최상위 필드:

| field | type | 설명 |
|---|---|---|
| `manifest_version` | string | 현재 `1.0` |
| `asset_pack_id` | UUID | pack identity |
| `asset_pack_version` | integer | canonical 내부 pack version |
| `canonical_character_id` | UUID | 정체성 anchor |
| `canonical_version` | integer | 생성에 사용된 canonical version |
| `style_version` | string | 시각 스타일 version |
| `provider` / `provider_model` | string | 생성 계보 |
| `prompt_version` / `config_version` | string | 재현·비교용 version |
| `generated_at` | RFC 3339 datetime | 완료 시각 |
| `assets` | array | 아래 asset record 목록 |

Asset record:

| field | type | 설명 |
|---|---|---|
| `asset_id` | UUID | 영구 asset identity |
| `behavior` | enum string | 상태/행동 |
| `orientation` | enum string | view/orientation |
| `media_type` | string | PoC는 `image/png` |
| `width`, `height` | integer | pixel dimensions |
| `has_transparency` | boolean | PoC 필수 true |
| `floor_anchor` | normalized point | 방 바닥 접점 |
| `visual_bounds` | normalized rect | 시각적 몸체 범위 |
| `source_generation_job_id` | UUID | 생성 job lineage |
| `generation_metadata` | object | provider usage/request metadata; UI 의미 없음 |
| `download_url` | string | 일시 signed URL 또는 local URL |

## 4. 좌표

- 좌표는 asset canvas 기준 0..1 normalized 값이다.
- origin은 좌상단이다.
- `floor_anchor.x/y`는 캐릭터가 바닥에 닿는 대표점이다.
- `visual_bounds`는 `{x, y, width, height}`다.
- PoC 기본 anchor는 `{x: 0.5, y: 0.96}`이며 자동 검증용 임시값이다. 최종 spatial pipeline 값이 아니다.

## 5. 기술 검사

Pack은 다음을 모두 통과해야 `succeeded`가 된다.

- 파일이 실제로 존재하고 읽히는 이미지
- 각 변 256~4096px 범위
- alpha/transparency 존재
- 필수 6개 behavior 누락 없음
- `asset_id` 중복 없음
- anchor/bounds 값이 0..1 범위
- asset의 canonical/job/pack lineage가 존재
- manifest와 DB asset record가 일치

자동 검사가 판단하지 않는 것:

- 실제 반려동물과 닮았는지
- 감정적으로 받아들일 수 있는지
- 털·눈·무늬의 미묘한 identity consistency
- 움직임으로 연결했을 때 자연스러운지

이는 human identity review 대상이다.

## 6. 호환성 규칙

- Frontend는 알려지지 않은 optional field를 무시한다.
- `manifest_version` major가 달라지면 호환되지 않는 것으로 본다.
- URL은 만료될 수 있으므로 저장하지 않는다.
- asset 선택은 filename이 아니라 `behavior + orientation`으로 한다.
- 새로운 필수 behavior 추가는 API/manifest contract 변경이다.
