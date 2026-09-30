# StayPet API Change Requests

상태: Open  
Backend owner: Codex  
Frontend requester: Claude Code

Claude Code는 backend 계약 변경이 필요할 때 이 문서에 요청을 추가한다. Source code에서 조용히 가정하거나 frontend 전용 우회 계약을 만들지 않는다.

## 요청 형식

```md
## ACR-YYYYMMDD-NN — 제목
- 상태: PROPOSED
- 요청자:
- 필요한 화면/flow:
- 현재 계약으로 막히는 이유:
- 요청하는 method/path/schema 변경:
- 호환성 영향:
- 필요한 시점:

### Backend 결정
- 상태: ACCEPTED / MODIFIED / REJECTED
- 결정일:
- 이유:
- 반영된 API_CONTRACT version/section:
```

## 현재 요청

## ACR-20260929-01 — source image 비활성화(삭제)
- 상태: PROPOSED
- 요청자: Claude Code (frontend)
- 필요한 화면/flow: 사진 자료 단계의 사진 빼기·바꾸기 (`UX_FINAL.md` §3.3, E3), 후보 불만족 시 `다시 준비하기 → 사진을 더하거나 바꾸기` (E8)
- 현재 계약으로 막히는 이유: 업로드된 source image를 비활성화할 방법이 없다. 활성 이미지는 후보 생성 입력에 자동 포함되고 5장 한도에도 계속 잡힌다. 그래서 frontend는 `이 사진으로 계속` 전까지 사진을 기기에만 두고, 올린 뒤에는 사진을 잠근다. 올린 사진을 바꾸는 경로는 현재 없다.
- 요청하는 method/path/schema 변경:
  - `DELETE /api/v1/pets/{pet_id}/source-images/{source_image_id}` → `204`
  - 의미: `is_active=false`. 이미 끝난 job의 `input_snapshot`과 canonical lineage는 그대로 둔다.
  - 오류: `404 source_image_not_found`
- 호환성 영향: 추가만 하므로 기존 client에 영향 없음
- 필요한 시점: 다음 frontend milestone (사진 바꾸기 / 사진을 바꿔서 다시 준비하기)

### Backend 결정
- 상태:
- 결정일:
- 이유:
- 반영된 API_CONTRACT version/section:

## ACR-20260929-02 — 반려동물 기본 정보 수정과 행동 프로필 저장
- 상태: PROPOSED
- 요청자: Claude Code (frontend)
- 필요한 화면/flow: 기본 정보(종·이름·**성별**, §3.2), 생활 문답 Q1 쓰다듬기 선호 부위(§3.4, 이번 slice에서는 사용자 결정으로 보류), 이후 Q2~Q6
- 현재 계약으로 막히는 이유:
  - `PetCreate`에는 `name`, `species`, `appearance_metadata`만 있다. 성별과 문답 답은 외형이 아니므로 `appearance_metadata`에 넣지 않았다. 지금은 브라우저에만 저장된다.
  - Pet 수정 endpoint가 없어서 생성 뒤 이름을 바꿔도 backend에 반영할 수 없다 (UX: 이름 변경은 재생성 없이 즉시 반영).
- 요청하는 method/path/schema 변경 (제안):
  - `PetCreate` / `PetResponse`에 `sex: "male" | "female" | null` 추가
  - `PATCH /api/v1/pets/{pet_id}` — `name`, `sex` 수정 (`species` 변경 정책은 backend 판단에 맡김)
  - `PUT /api/v1/pets/{pet_id}/behavior-profile` — `{ "preferred_petting_zones": ["head","belly","rump","back"], ... }` (Q2~Q6은 이후 같은 resource에 추가)
  - `GET /api/v1/pets/{pet_id}` — 재진입 시 기본 정보를 복원하기 위함
- 호환성 영향: 필드와 endpoint를 추가만 하고 `sex` 기본값은 null이라 기존 client에 영향 없음
- 필요한 시점: Q1을 slice에 넣을 때 (다음 milestone)

### Backend 결정
- 상태:
- 결정일:
- 이유:
- 반영된 API_CONTRACT version/section:

## ACR-20260929-03 — 재진입용 조회 (내 pet 목록, pet의 최신 job)
- 상태: PROPOSED
- 요청자: Claude Code (frontend)
- 필요한 화면/flow: 생성 대기 중 이탈 뒤 복귀 (§3.5, E6), 후보 숨김 뒤 재진입 (§3.6)
- 현재 계약으로 막히는 이유: 소유자의 pet이나 pet의 진행 중 job을 찾는 endpoint가 없다. frontend가 `pet_id`, `job_id`, `canonical_id`를 localStorage에 두고 복원한다. 같은 브라우저 재진입은 되지만, 저장소를 지우거나 기기를 바꾸면 진행 상태를 찾을 수 없다. canonical 결정은 backend에 있고 `GET /pets/{id}/canonical-character`로 확인하지만, 그 출발점인 `pet_id`가 필요하다.
- 요청하는 method/path/schema 변경 (제안):
  - `GET /api/v1/pets` — 소유자 pet 목록 (최신순)
  - `GET /api/v1/pets/{pet_id}/generation-jobs?job_type=candidate_generation&limit=1` — 최신 job
- 호환성 영향: 추가만 함
- 필요한 시점: 실제 인증(Supabase JWT) 연동 전후. mock 연동을 막지는 않는다.

### Backend 결정
- 상태:
- 결정일:
- 이유:
- 반영된 API_CONTRACT version/section:

## ACR-20260929-04 — 보정 기록(`corrections`) 형식 확인
- 상태: PROPOSED (확인 요청)
- 요청자: Claude Code (frontend)
- 필요한 화면/flow: 간단 보정 (§3.7). 이번 slice에서는 사용자 결정으로 "조금 다른 점 알려 주기" 메모 형태로 구현했다.
- 현재 계약으로 막히는 이유: 막히지는 않는다. 계약 예시는 `{field, from, to}`인데, 사용자가 적는 메모에는 `from`(이전 값)이 없다.
- 현재 frontend가 보내는 값:
  ```json
  {
    "candidate_id": "...",
    "appearance_metadata": {"shape_note": "귀가 조금 더 커요", "marking_note": "왼쪽 귀가 더 짙은 갈색이에요"},
    "corrections": [
      {"field": "shape_note", "from": null, "to": "귀가 조금 더 커요"},
      {"field": "marking_note", "from": null, "to": "왼쪽 귀가 더 짙은 갈색이에요"}
    ]
  }
  ```
  canonical 이미지 자체는 바뀌지 않는다. 메모는 canonical `appearance_metadata`에 합쳐져 asset-pack prompt에 쓰인다. 화면 문구도 "고른 모습은 그대로 두고, 집에서 지낼 모습을 준비할 때 참고할게요"로 이에 맞췄다.
- 요청: 이 형식이 괜찮은지, `shape_note` / `marking_note` 키 이름을 backend가 정할지 확인. 보정 결과가 이미지에 반영되는 흐름(보정 재생성)이 계획에 있다면 별도 계약으로 알려 주기.
- 호환성 영향: 없음 (확인만)
- 필요한 시점: 실공급자 asset-pack 평가 전
