# StayPet Backend PoC

FastAPI + Postgres/Supabase Storage 기반의 identity-preserving character generation vertical slice다.

## Local mock run

```bash
python3 -m venv .venv
.venv/bin/pip install -e '.[test]'
cp .env.example .env
.venv/bin/uvicorn app.main:app --reload
```

별도 terminal에서 worker를 실행한다.

```bash
.venv/bin/python -m app.worker
```

API 계약은 `../docs/API_CONTRACT.md`를 따른다. Mock와 OpenAI provider는 같은 API를 사용한다.

## Supabase

1. `supabase/migrations/202609290001_character_generation_poc.sql` 적용
2. `DATABASE_URL`을 Supabase direct/session-pooler Postgres URL로 설정
3. `AUTO_CREATE_SCHEMA=false`, `STORAGE_BACKEND=supabase`
4. `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`를 server 환경에만 설정

`staypet-assets` bucket은 private이며 migration이 생성한다.

## Real provider

```env
GENERATION_PROVIDER=openai
OPENAI_API_KEY=...
OPENAI_IMAGE_MODEL=gpt-image-2.5-sunburst
```

OpenAI adapter는 reference images를 사용하는 Image API edit workflow를 사용한다. 실제 호출 전 계정의 GPT Image 접근 및 조직 검증 상태를 확인한다.

## Tests

```bash
.venv/bin/pytest
```

Frontend 파일인 `hifi/`, 동결된 `lowfi/`를 이 backend가 수정하거나 import하지 않는다.
