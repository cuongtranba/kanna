---
target: c3-236
scope: insert
base: c3-236#n11804@v1:sha256:fda6cb7ebc698d38954ae650d950cfe9cfb04f765f57f93705d05fc3c845ae8f
---
| ESLINT_LIMIT_PINS | IN | Each pin must equal the ceiling eslint.config.js configures for that rule. Raising it is limit_raised; lowering the ceiling without lowering the pin is limit_slack; a pin whose rule eslint no longer configures is limit_unconfigured rather than a vacuous pass. | ESLint owns the per-function measurement a regex cannot make; the budget owns only the direction. | src/ops/architecture/budget.ts |
| readEslintLimits | OUT | Reads ceilings from the real eslint.config.js rather than a transcription, so a pin and the enforced value cannot agree on paper while disagreeing in fact. | Imports the config module; the only non-filesystem reader in the component. | src/ops/architecture/budget-scan.adapter.ts |
| bun run lint:limits | OUT | Runs ESLint once with every ceiling lowered by one and requires each rule to report at least one production violation, proving the ceiling is tight rather than slack. | Reuses PRODUCTION_EXCLUDES so production means one thing across both gates. | scripts/check-complexity-limits.ts |
