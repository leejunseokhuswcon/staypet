# StayPet Identity Generation PoC Evaluation

상태: 첫 실샘플 대기  
주의: 아래 수치는 **INITIAL TEST THRESHOLDS / HYPOTHESES**이며 제품 KPI나 영구 정책이 아니다.

## 평가 질문

1. 2~5장의 사진에서 수용 가능한 canonical 후보가 나오는가?
2. 재생성은 몇 회 필요한가?
3. canonical에서 6개 상태로 갈 때 같은 반려동물로 인식되는가?
4. 털색·무늬·귀·주둥이·눈·체형이 치명적으로 바뀌는가?
5. 후보와 pack의 latency, failure, retry, provider usage/cost는 얼마인가?

## 초기 표본 가설

- 동의받은 반려동물 12~20마리
- 개/고양이, 장모/단모, 단색/무늬, 특징이 뚜렷한/적은 사례 포함
- 실제 첫 provider run은 각 pet reference 2~5장

## 초기 통과 가설

- 최소 80%의 pet에서 2개 candidate batch 이내 수용 가능한 canonical 1개
- blind identity matching 90% 이상
- 승인 pack에서 종·털색·대표 무늬·귀·주둥이 등 치명적 특징 변경 0건
- 승인 pack은 필수 상태 6개와 manifest 기술 검사를 100% 통과
- 정상 사례는 수작업 Photoshop 없이 pack 완성

첫 샘플 이후 난이도와 관찰자 일치도를 보고 이 수치를 수정한다. 수치를 제품 truth로 다른 문서에 복사하지 않는다.

## 기록 필드

- `candidate_acceptable`
- `regeneration_batches`
- `identity_consistency_score`
- `blind_match_correct`
- `catastrophic_feature_change`
- `candidate_latency_seconds`
- `pack_latency_seconds`
- `failure_count`, `retry_count`
- provider/model/prompt/config version
- provider request IDs/usage와, 실행 시점의 공식 가격표로 계산한 `provider_cost_usd`
- human notes

## 도구

```bash
cd backend
python -m app.evaluation --format csv --out var/evaluation/identity-poc.csv
```

도구가 기술 job 행을 내보내면 human reviewer가 likeness 관련 빈 열을 채운다. 자동 평가가 사람의 정체성 판단을 대체하지 않는다.
