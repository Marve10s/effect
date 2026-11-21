---
"effect": patch
---

Fix stream atoms reporting an earlier value as `Success` when a run, such as a rerun or refresh, completes without emitting; they now fail with `NoSuchElementError` and keep that value as `previousSuccess`.
