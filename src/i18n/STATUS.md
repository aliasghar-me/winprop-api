# i18n Translation Status

| Locale | Language | Status | Notes |
|--------|----------|--------|-------|
| `en` | English | source / reviewed | Authored source strings — do not machine-translate |
| `ur` | Urdu | draft (machine, needs native review) | **Tier-1** — required review before production |
| `ar` | Arabic | draft (machine, needs native review) | **Tier-1** — required review before production |
| `fr` | French | draft (machine, needs native review) | **Tier-1** — required review before production |
| `es` | Spanish | draft (machine) | |
| `hi` | Hindi | draft (machine) | |
| `pt` | Portuguese | draft (machine) | |
| `bn` | Bengali | draft (machine) | |
| `ru` | Russian | draft (machine) | |
| `zh` | Chinese (Simplified) | draft (machine) | |

## Tier-1 (Priority for native review before production)
`ur`, `ar`, `fr` — highest geographic relevance; block production deployment until reviewed.

## Interpolation syntax
nestjs-i18n v10.8.4 uses double-brace `{{varName}}` for ICU-style interpolation.
