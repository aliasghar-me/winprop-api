# i18n Translation Status

| Locale | Language | Status | Notes |
|--------|----------|--------|-------|
| `en` | English | source / reviewed | Authored source strings — do not machine-translate |
| `ur` | Urdu | **reviewed** (AI native-grade, 2026-06-25) | **Tier-1** — see review note below |
| `ar` | Arabic | **reviewed** (AI native-grade, 2026-06-25) | **Tier-1** — see review note below |
| `fr` | French | **reviewed** (AI native-grade, 2026-06-25) | **Tier-1** — see review note below |
| `es` | Spanish | draft (machine) | |
| `hi` | Hindi | draft (machine) | |
| `pt` | Portuguese | draft (machine) | |
| `bn` | Bengali | draft (machine) | |
| `ru` | Russian | draft (machine) | |
| `zh` | Chinese (Simplified) | draft (machine) | |

## Namespaces
Each locale ships two namespaces, both with enforced Tier-1 key coverage (see CI guard):
- `errors.json` — `AppException` business errors.
- `validation.json` — class-validator / `ValidationPipe` messages (H8). Messages may use
  `{property}` (the field name) and positional constraint args `{0}`, `{1}`.

## Tier-1 native review (H9) — done 2026-06-25
`ur`, `ar`, `fr` were reviewed for register, terminology, and orthography (no longer blind
machine drafts). Findings applied this pass:

- **fr**: "Job" was mistranslated as **"offre d'emploi"** (a job *vacancy*). In WinProp a Job is
  a client opportunity you pitch a proposal for (status `active` → `won`). Corrected to
  **"mission"**, matching the web app's existing fr copy (`messages/fr.json` → "Vos missions").
- **ar**: "Job" kept as **"الوظيفة"** — intentionally consistent with the web app's ar copy.
- **ur**: "Job" kept as **"کام"** — consistent with the web app's ur copy; fixed the orthography
  of "چاہئیں" in `duplicateName`.
- `validation.json` for ur/ar/fr authored at native-grade in the same pass.

> Transparency: this is an **AI-produced native-grade review**, not a certified human
> sign-off. Before a production launch into these markets, have a human native speaker
> spot-check tone/register. The CI guard enforces *key completeness*, not translation quality;
> text-expansion still needs visual QA.

## Interpolation syntax
`nestjs-i18n` v10.8.4 interpolates **single-brace** placeholders: `{provider}`, `{limit}`,
`{name}`, `{0}`. (Earlier docs here said double-brace `{{ }}` — that was incorrect; the source
`en/*.json` and all locales use single-brace, and the e2e tests confirm single-brace
interpolation works.)
