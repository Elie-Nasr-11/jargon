/**
 * School · Health — live sessions, errors, and cost. Read-only.
 *
 * Rebuild brief, step 7. The old window had these as two separate tabs, Live and
 * Cost & runtime, which meant an admin asking "is anything wrong right now?" had
 * to check two places and hold the answer in their head. They are one question:
 * what is the system doing, and is it healthy. Nothing here is a control — every
 * action lives on the screen that owns the object.
 *
 * Dollar-cost totals stay platform-admin only; org admins see scoped usage and
 * reliability, which is the visibility contract admin-ops already enforces
 * server-side (this screen renders what it is given, it does not decide).
 */
import { Activity, BarChart3, DollarSign, RefreshCw } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { auditEventLabel, orgAuditEvents, timeAgo } from "./adminData";
import type { ActiveSession, AdminScope, CostModelDashboard, CostModelMetric } from "@/lib/types";

function formatDate(value?: string | null) {
  if (!value) return "Never";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function formatNumber(value: number | null | undefined) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value || 0);
}

function formatCompactNumber(value: number | null | undefined) {
  return new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value || 0);
}

function formatUsd(value: number | null | undefined) {
  if (value === null || value === undefined) return "Hidden";
  if (value > 0 && value < 0.01) return "<$0.01";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value < 1 ? 4 : 2,
  }).format(value);
}

function formatMs(value: number | null | undefined) {
  if (!value) return "n/a";
  if (value >= 1000) return `${(value / 1000).toFixed(1)}s`;
  return `${Math.round(value)}ms`;
}

function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined) return "n/a";
  return `${Math.round(value * 100)}%`;
}

function MetricStat({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="rounded-card border border-border/75 bg-depth-sub p-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        {icon}
        <span className="text-overline uppercase tracking-[0.1em]">{label}</span>
      </div>
      <div className="mt-2 text-[22px] font-semibold tabular-nums leading-none text-foreground">
        {value}
      </div>
    </div>
  );
}

function CostMetricTable({
  title,
  rows,
  showCost,
  empty,
  wide = false,
}: {
  title: string;
  rows: CostModelMetric[];
  showCost: boolean;
  empty: string;
  wide?: boolean;
}) {
  return (
    <div className="rounded-card border border-border/80 bg-depth-sub p-4">
      <h3 className="text-body font-medium text-foreground">{title}</h3>
      <div className="table-scroll mt-3">
        <table
          className={`${wide ? "min-w-[860px]" : "min-w-[620px]"} w-full border-collapse text-left text-meta`}
        >
          <thead className="border-b border-border text-overline uppercase tracking-[0.1em] text-muted-foreground">
            <tr>
              <th className="py-2 pr-3 font-medium">Scope</th>
              <th className="py-2 pr-3 font-medium">Model</th>
              <th className="py-2 pr-3 font-medium">Tokens</th>
              <th className="py-2 pr-3 font-medium">Events</th>
              <th className="py-2 pr-3 font-medium">Latency</th>
              <th className="py-2 font-medium">Cost</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, wide ? 12 : 8).map((row) => (
              <tr key={row.key} className="border-b border-border/55">
                <td className="py-2 pr-3">
                  <div className="font-medium text-foreground">{row.label}</div>
                  <div className="mt-0.5 text-meta text-muted-foreground">
                    {row.completion_count} completions · {row.session_count} sessions
                  </div>
                </td>
                <td className="py-2 pr-3 text-muted-foreground">
                  {row.model || row.task_type?.replaceAll("_", " ") || "mixed"}
                </td>
                <td className="py-2 pr-3 text-muted-foreground">
                  {formatCompactNumber(row.total_tokens)}
                </td>
                <td className="py-2 pr-3 text-muted-foreground">
                  {formatNumber(
                    row.model_event_count + row.runtime_event_count + row.speech_event_count,
                  )}
                  {row.error_count ? (
                    <span className="ml-1 text-warning">
                      ({row.error_count} error{row.error_count === 1 ? "" : "s"})
                    </span>
                  ) : null}
                </td>
                <td className="py-2 pr-3 text-muted-foreground">
                  {formatMs(row.average_latency_ms)}
                </td>
                <td className="py-2 text-muted-foreground">
                  {showCost ? formatUsd(row.estimated_cost_usd) : "Hidden"}
                </td>
              </tr>
            ))}
            {!rows.length ? (
              <tr>
                <td className="py-4 text-muted-foreground" colSpan={6}>
                  {empty}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function HealthPanel({
  scope,
  organizationId,
  isPlatformLevel,
  activeSessions,
  activeSessionsLoading,
  activeSessionsError,
  onRefreshActiveSessions,
  costDashboard,
  costLoading,
  costMessage,
  costVisible,
  onRefreshCostDashboard,
  liveAgo,
}: {
  scope: AdminScope;
  organizationId: string;
  isPlatformLevel: boolean;
  activeSessions: ActiveSession[] | null;
  activeSessionsLoading: boolean;
  activeSessionsError: string;
  onRefreshActiveSessions: () => void;
  costDashboard: CostModelDashboard | null;
  costLoading: boolean;
  costMessage: string;
  costVisible: boolean;
  onRefreshCostDashboard: () => void;
  liveAgo: (iso: string) => string;
}) {
  // R51's Overview carried the admin activity trail. Overview dissolved into Setup
  // in R84, and a trail of who changed what is an observation, not a setup step —
  // so it lands here rather than being deleted with the screen that held it.
  const events = orgAuditEvents(scope, organizationId).slice(0, 8);

  return (
    <div className="grid gap-4">
      <section className="rounded-card border border-border bg-depth-card shadow-card">
        <div className="p-4 sm:p-6">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-title font-medium text-foreground">
                Live sessions
                {activeSessions?.length ? (
                  <span className="ml-2 text-body font-normal text-muted-foreground">
                    {activeSessions.length}
                  </span>
                ) : null}
              </h2>
              <p className="mt-1 text-body text-muted-foreground">
                Students active in the last 30 minutes across your{" "}
                {isPlatformLevel ? "platform" : "organization"}.
              </p>
            </div>
            <button
              type="button"
              onClick={() => onRefreshActiveSessions()}
              disabled={activeSessionsLoading}
              className="btn btn-secondary btn-sm shrink-0"
            >
              {activeSessionsLoading ? "Refreshing…" : "Refresh"}
            </button>
          </div>
          {activeSessionsError ? (
            <p className="text-body text-danger">
              {activeSessionsError}{" "}
              <button
                type="button"
                onClick={() => onRefreshActiveSessions()}
                className="underline hover:no-underline"
              >
                Retry
              </button>
            </p>
          ) : activeSessions === null ? (
            <p className="text-body text-muted-foreground">Loading live sessions…</p>
          ) : activeSessions.length === 0 ? (
            <EmptyState icon={Activity}>No students are in a live session right now.</EmptyState>
          ) : (
            <div className="grid gap-2">
              {activeSessions.map((s) => {
                const struggling = s.status === "needs_retry" || s.status === "needs_rescue";
                return (
                  <div
                    key={s.session_id}
                    className="flex items-center gap-3 rounded-card border border-border bg-depth-field px-3 py-2.5"
                  >
                    <span className="relative flex h-2 w-2 shrink-0">
                      <span
                        className={`absolute inline-flex h-full w-full animate-ping rounded-full ${struggling ? "bg-warning/60" : "bg-success/60"}`}
                      />
                      <span
                        className={`relative inline-flex h-2 w-2 rounded-full ${struggling ? "bg-warning" : "bg-success"}`}
                      />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-body text-foreground">{s.student_name}</div>
                      <div className="truncate text-meta text-muted-foreground">
                        {s.lesson_title}
                        {s.class_name ? ` · ${s.class_name}` : ""}
                        {s.stage ? ` · ${s.stage}` : ""}
                      </div>
                    </div>
                    {struggling ? (
                      <span className="shrink-0 rounded-full border border-warning/40 px-2 py-0.5 text-overline text-warning">
                        Needs attention
                      </span>
                    ) : null}
                    <span className="shrink-0 text-meta text-muted-foreground">
                      {liveAgo(s.updated_at)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>
      <section className="rounded-card border border-border bg-depth-card shadow-card">
        <div className="space-y-5 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
                <Activity className="h-3.5 w-3.5" strokeWidth={1.7} />
                AI/runtime operations
              </div>
              <h2 className="text-title font-medium text-foreground">
                Usage, reliability, and model load
              </h2>
              <p className="mt-1 max-w-2xl text-meta leading-relaxed text-muted-foreground">
                {costVisible
                  ? "Platform admins see estimated model cost, tokens, latency, and failure signals across the pilot."
                  : "Org admins see scoped usage and reliability. Dollar-cost totals stay platform-admin only."}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onRefreshCostDashboard()}
              disabled={costLoading}
              className="btn btn-secondary"
            >
              <RefreshCw
                className={`h-4 w-4 ${costLoading ? "animate-spin" : ""}`}
                strokeWidth={1.6}
              />
              Refresh metrics
            </button>
          </div>

          {costMessage ? (
            <div className="rounded-card border border-border bg-depth-sub px-3 py-2 text-meta text-muted-foreground">
              {costMessage}
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <MetricStat
              icon={<DollarSign className="h-4 w-4" strokeWidth={1.6} />}
              label="Estimated cost"
              value={formatUsd(costDashboard?.totals.estimated_cost_usd)}
            />
            <MetricStat
              icon={<BarChart3 className="h-4 w-4" strokeWidth={1.6} />}
              label="Total tokens"
              value={formatCompactNumber(costDashboard?.totals.total_tokens)}
            />
            <MetricStat
              label="Model events"
              value={formatNumber(costDashboard?.totals.model_event_count)}
            />
            <MetricStat
              label="Avg latency"
              value={formatMs(costDashboard?.totals.average_latency_ms)}
            />
            <MetricStat
              label="Errors"
              value={`${formatNumber(costDashboard?.totals.error_count)} · ${formatPercent(
                costDashboard?.totals.error_rate,
              )}`}
            />
          </div>

          <div className="rounded-card border border-border/80 bg-depth-sub p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-body font-medium text-foreground">Runtime health</h3>
                <p className="mt-1 text-meta text-muted-foreground">
                  Engine wakeups, retry recoveries, controlled code errors, and pilot safety limits
                  from recent runtime events.
                </p>
              </div>
              <div className="text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
                Last event {formatDate(costDashboard?.runtime_health?.last_runtime_event_at)}
              </div>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <MetricStat
                label="Run failures"
                value={formatNumber(costDashboard?.runtime_health?.run_failures)}
              />
              <MetricStat
                label="Wake timeouts"
                value={formatNumber(costDashboard?.runtime_health?.engine_wake_timeouts)}
              />
              <MetricStat
                label="Retry recoveries"
                value={formatNumber(costDashboard?.runtime_health?.engine_retry_successes)}
              />
              <MetricStat
                label="Rate limits"
                value={formatNumber(costDashboard?.runtime_health?.rate_limit_hits)}
              />
              <MetricStat
                label="Controlled errors"
                value={formatNumber(costDashboard?.runtime_health?.controlled_errors)}
              />
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <CostMetricTable
              title="Model breakdown"
              rows={costDashboard?.by_model || []}
              showCost={costVisible}
              empty="No model usage recorded yet."
            />
            <CostMetricTable
              title="Task type breakdown"
              rows={costDashboard?.by_task_type || []}
              showCost={costVisible}
              empty="No task usage recorded yet."
            />
          </div>

          <CostMetricTable
            title="Class operating load"
            rows={costDashboard?.by_class || []}
            showCost={costVisible}
            empty="No class-scoped usage recorded yet."
            wide
          />

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-card border border-border/80 bg-depth-sub p-4">
              <h3 className="text-body font-medium text-foreground">Recent model events</h3>
              <div className="mt-3 space-y-2">
                {(costDashboard?.recent_model_events || []).slice(0, 6).map((event) => (
                  <div key={event.id} className="border-b border-border/55 pb-2 text-meta">
                    <div className="text-foreground">
                      {event.model} · {event.task_type.replaceAll("_", " ")}
                    </div>
                    <div className="mt-0.5 text-muted-foreground">
                      {formatCompactNumber(
                        event.input_tokens + event.output_tokens + event.cached_tokens,
                      )}{" "}
                      tokens · {formatMs(event.latency_ms)} · {formatUsd(event.estimated_cost_usd)}
                    </div>
                  </div>
                ))}
                {!costDashboard?.recent_model_events.length ? (
                  <div className="text-meta text-muted-foreground">
                    No model events recorded yet.
                  </div>
                ) : null}
              </div>
            </div>

            <div className="rounded-card border border-border/80 bg-depth-sub p-4">
              <h3 className="text-body font-medium text-foreground">Runtime errors</h3>
              <div className="mt-3 space-y-2">
                {(costDashboard?.recent_runtime_errors || []).slice(0, 6).map((event) => (
                  <div key={event.id} className="border-b border-border/55 pb-2 text-meta">
                    <div className="text-foreground">
                      {event.event_type} · {event.lesson_id || "no lesson"}
                    </div>
                    <div className="mt-0.5 text-muted-foreground">
                      {event.session_id || "no session"} · {formatDate(event.created_at)}
                    </div>
                  </div>
                ))}
                {!costDashboard?.recent_runtime_errors.length ? (
                  <div className="text-meta text-muted-foreground">
                    No runtime errors in the current scope.
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </section>
      <section className="rounded-card border border-border bg-depth-card shadow-card">
        <div className="p-4 sm:p-6">
          <h2 className="text-title font-medium text-foreground">Recent activity</h2>
          <p className="mt-1 text-meta text-muted-foreground">
            The last admin actions on this organization.
          </p>
          <div className="mt-3 grid gap-1.5">
            {events.length ? (
              events.map((event) => (
                <div
                  key={event.id}
                  className="flex items-center gap-2 rounded-control border border-border bg-depth-field px-3 py-1.5 text-meta"
                >
                  <span className="min-w-0 flex-1 truncate text-foreground">
                    {auditEventLabel(event)}
                  </span>
                  <span className="shrink-0 text-muted-foreground">
                    {timeAgo(event.created_at)}
                  </span>
                </div>
              ))
            ) : (
              <p className="text-meta text-muted-foreground">Nothing yet.</p>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
