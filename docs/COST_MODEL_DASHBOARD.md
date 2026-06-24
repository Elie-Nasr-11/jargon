# Cost And Model Dashboard

The Cost/Model Dashboard is a platform-ops view for understanding AI/runtime load during a pilot.
It is not a billing statement.

## Audience And Visibility

- Platform admins see global usage, reliability, latency, token counts, and estimated dollar cost.
- Org admins see scoped organization usage and reliability, but dollar-cost totals are hidden.
- Students and teachers do not access this dashboard.

## Data Sources

The dashboard reads existing telemetry tables through the privileged `admin-ops` Edge Function:

- `model_usage_events`: model, task type, tokens, latency, status, and estimated cost when available.
- `runtime_events`: chat/run failures, controlled errors, stage transitions, retry/rescue, and completions.
- `speech_usage_events`: browser or future speech usage events.
- `learning_sessions`: session and completion counts for class/student/lesson context.

The frontend never reads these tables with a service role key. `admin-ops` verifies the caller JWT,
checks platform-admin or org-admin access, scopes the result, and returns an aggregated dashboard.

## Metrics

- `Estimated cost`: best-effort sum of `estimated_cost_usd` in telemetry rows. Missing estimates count as zero.
- `Total tokens`: input + output + cached tokens from `model_usage_events`.
- `Average latency`: average of model/runtime event latency values when recorded.
- `Error rate`: error events divided by model/runtime/speech events.
- Breakdowns: organization, class, student, model, task type, and lesson where scope data exists.
- `Runtime health`: recent run failures, Render wake timeouts, retry recoveries, controlled code errors,
  and pilot rate-limit hits from structured `runtime_events.payload.reason` values.

## Interpretation Rules

- Cost is an estimate for operations planning, not invoice truth.
- Missing telemetry means "not recorded yet," not necessarily zero usage.
- Org-admin views intentionally hide cost so schools can see reliability without platform-level billing data.
- Risk and intervention labels should come from recorded evidence; this dashboard should not invent AI-based labels.
- Runtime-health counts are operational signals, not student performance signals. A retry recovery means
  the system handled a transient engine wake/failure and continued.

## Live Smoke

1. Open `/admin` as a platform admin.
2. Confirm `AI/runtime operations` loads.
3. Confirm estimated cost is visible for platform admins.
4. Promote or use an org admin and confirm usage/reliability is scoped to that organization and cost shows `Hidden`.
5. Complete one lesson as a student.
6. Refresh the dashboard and confirm sessions/completions and any new model/runtime telemetry update.
7. Trigger one controlled Jargon error and confirm a runtime error appears.
