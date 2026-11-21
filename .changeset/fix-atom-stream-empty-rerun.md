---
"effect": patch
---

Fix stream atoms reporting the previous run's value as `Success` when a rerun or refresh completes without emitting; they now fail with `NoSuchElementError` and keep that value as `previousSuccess`.
