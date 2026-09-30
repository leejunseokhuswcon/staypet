/* ============================================================
   StayPet resource functions — one per endpoint in docs/API_CONTRACT.md v1.
   UI code calls these; it never builds URLs or calls fetch() itself.
   Responses are returned as the contract defines them (snake_case).
   ============================================================ */

const enc = encodeURIComponent;

export const JOB_TERMINAL = Object.freeze(['succeeded', 'failed']);

export function isTerminalJob(job) {
  return !!job && JOB_TERMINAL.includes(job.status);
}

export function newIdempotencyKey(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function createStayPetApi(client) {
  const req = client.request;
  return {
    /** POST /pets → Pet */
    createPet({ name, species, appearanceMetadata = {} }, opts = {}) {
      return req('POST', '/pets', { ...opts, json: { name, species, appearance_metadata: appearanceMetadata } });
    },

    /** POST /pets/{id}/source-images (multipart) → SourceImage */
    uploadSourceImage(petId, file, { sortOrder = 0, signal } = {}) {
      const form = new FormData();
      form.append('file', file);
      form.append('sort_order', String(sortOrder));
      return req('POST', `/pets/${enc(petId)}/source-images`, { form, signal });
    },

    /** GET /pets/{id}/source-images → SourceImage[] (no image URLs by contract) */
    listSourceImages(petId, opts = {}) {
      return req('GET', `/pets/${enc(petId)}/source-images`, opts);
    },

    /** POST /pets/{id}/candidate-generation-jobs → GenerationJob (202) */
    createCandidateGenerationJob(petId, { candidateCount = 3, idempotencyKey }, opts = {}) {
      return req('POST', `/pets/${enc(petId)}/candidate-generation-jobs`, {
        ...opts, idempotencyKey, json: { candidate_count: candidateCount },
      });
    },

    /** GET /generation-jobs/{id} → GenerationJob */
    getGenerationJob(jobId, opts = {}) {
      return req('GET', `/generation-jobs/${enc(jobId)}`, opts);
    },

    /** GET /pets/{id}/candidates?generation_job_id= → Candidate[] */
    listCandidates(petId, generationJobId, opts = {}) {
      return req('GET', `/pets/${enc(petId)}/candidates?generation_job_id=${enc(generationJobId)}`, opts);
    },

    /** POST /pets/{id}/canonical-characters → CanonicalCharacter (201) */
    selectCanonicalCharacter(petId, { candidateId, appearanceMetadata = {}, corrections = [] }, opts = {}) {
      return req('POST', `/pets/${enc(petId)}/canonical-characters`, {
        ...opts,
        json: { candidate_id: candidateId, appearance_metadata: appearanceMetadata, corrections },
      });
    },

    /** GET /pets/{id}/canonical-character → latest CanonicalCharacter */
    getCanonicalCharacter(petId, opts = {}) {
      return req('GET', `/pets/${enc(petId)}/canonical-character`, opts);
    },

    /** POST /canonical-characters/{id}/asset-pack-generation-jobs → GenerationJob (202) */
    createAssetPackGenerationJob(canonicalId, { idempotencyKey }, opts = {}) {
      return req('POST', `/canonical-characters/${enc(canonicalId)}/asset-pack-generation-jobs`, {
        ...opts, idempotencyKey, json: {},
      });
    },

    /** GET /canonical-characters/{id}/asset-pack → raw manifest (parse with character/manifest.js) */
    getAssetPack(canonicalId, opts = {}) {
      return req('GET', `/canonical-characters/${enc(canonicalId)}/asset-pack`, opts);
    },
  };
}
