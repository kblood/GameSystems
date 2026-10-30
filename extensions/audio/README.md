# Audio extension

## Pending-start cancellation

`cancelPendingStarts()` cancels sources whose scheduled start remains later than the audio clock. Active tails, shared context, master gain and buffers remain intact. The host owns pause timing; no event replay is imposed. Static source review only (2026-10-26); no audio/runtime tests executed.
