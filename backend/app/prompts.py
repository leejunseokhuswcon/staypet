from __future__ import annotations

STYLE_VERSION = "stylized-real-v1"
CONFIG_VERSION = "character-poc-v1"
CANDIDATE_PROMPT_VERSION = "candidate-v1"
ASSET_PROMPT_VERSION = "asset-pack-v1"


def candidate_prompt(species: str, appearance_metadata: dict, candidate_index: int) -> str:
    traits = ", ".join(f"{key}: {value}" for key, value in sorted(appearance_metadata.items()))
    return f"""
Create candidate {candidate_index + 1} for the same {species} shown in every reference image.
Preserve the individual animal's identity: face proportions, muzzle, ear shape, eye placement,
coat color, coat pattern, markings, body proportions, and distinctive features.
Target style: semi-realistic, stylized-real 2.5D character with believable physical volume,
soft natural fur, calm warm expression, and no human accessories.
Avoid generic breed substitution, cartoon exaggeration, plush-toy appearance, chibi proportions,
text, scenery, furniture, and unrelated animals.
Render one full-body neutral three-quarter view, fully visible, centered, on transparent background.
Known appearance metadata: {traits or 'none supplied; rely on the reference images'}.
""".strip()


STATE_GUIDANCE = {
    "idle": ("front_three_quarter", "standing calmly in a neutral attentive idle pose"),
    "walk": ("left_side", "walking naturally toward the left with believable limb placement"),
    "sleep": ("left_three_quarter", "sleeping comfortably in a natural curled or settled pose"),
    "eat": ("left_three_quarter", "lowering the head naturally as if eating from a bowl; no bowl visible"),
    "play": ("left_three_quarter", "engaged in a playful alert pose; no toy visible"),
    "pet_positive": ("front_three_quarter", "showing a gentle positive response to being petted"),
}


def asset_prompt(species: str, behavior: str, appearance_metadata: dict) -> tuple[str, str]:
    orientation, pose = STATE_GUIDANCE[behavior]
    traits = ", ".join(f"{key}: {value}" for key, value in sorted(appearance_metadata.items()))
    prompt = f"""
Using the reference image as the canonical identity, create the exact same {species} in this state:
{pose}. Preserve facial identity, coat color and markings, ear and muzzle shape, eye placement,
body proportions, and stylized-real rendering. Do not redesign or beautify the animal.
Keep the whole body visible with consistent scale and camera height. Transparent background only.
No text, scenery, furniture, bowl, toy, clothing, duplicate limbs, or additional animals.
Known appearance metadata: {traits or 'none supplied; preserve the canonical reference exactly'}.
""".strip()
    return orientation, prompt
