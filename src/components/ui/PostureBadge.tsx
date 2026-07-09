import {
  Archive,
  Beaker,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleHelp,
  Clock3,
  FlaskConical,
  Radio,
  ShieldCheck,
  Sparkles,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type {
  ProjectEvidenceLevel,
  ProjectLifecycle,
  ProjectMaturity,
} from "@/lib/content/schema";

export type ProjectHealthPosture =
  | "healthy"
  | "degraded"
  | "disruption"
  | "unavailable"
  | "not-monitored";

type PostureBadgeProps =
  | { dimension: "lifecycle"; value: ProjectLifecycle }
  | { dimension: "maturity"; value: ProjectMaturity }
  | { dimension: "health"; value: ProjectHealthPosture }
  | { dimension: "evidence"; value: ProjectEvidenceLevel };

type Tone = "positive" | "information" | "warning" | "failure" | "neutral";

interface BadgeConfig {
  label: string;
  tone: Tone;
  icon: LucideIcon;
}

const lifecycle: Record<ProjectLifecycle, BadgeConfig> = {
  active: { label: "Active", tone: "positive", icon: Radio },
  maintained: { label: "Maintained", tone: "information", icon: Wrench },
  paused: { label: "Paused", tone: "warning", icon: Clock3 },
  archived: { label: "Archived", tone: "neutral", icon: Archive },
};

const maturity: Record<ProjectMaturity, BadgeConfig> = {
  flagship: { label: "Flagship", tone: "positive", icon: Sparkles },
  stable: { label: "Stable", tone: "information", icon: ShieldCheck },
  experimental: { label: "Experimental", tone: "warning", icon: FlaskConical },
  reference: { label: "Reference", tone: "neutral", icon: Beaker },
};

const health: Record<ProjectHealthPosture, BadgeConfig> = {
  healthy: { label: "Healthy", tone: "positive", icon: CircleCheck },
  degraded: { label: "Degraded", tone: "warning", icon: CircleAlert },
  disruption: { label: "Disruption", tone: "failure", icon: CircleAlert },
  unavailable: { label: "Unavailable", tone: "neutral", icon: CircleHelp },
  "not-monitored": {
    label: "Not monitored",
    tone: "neutral",
    icon: CircleDashed,
  },
};

const evidence: Record<ProjectEvidenceLevel, BadgeConfig> = {
  "source-reviewed": {
    label: "Source reviewed",
    tone: "neutral",
    icon: CircleCheck,
  },
  "ci-verified": {
    label: "CI verified",
    tone: "information",
    icon: ShieldCheck,
  },
  "live-verified": {
    label: "Live verified",
    tone: "positive",
    icon: CircleCheck,
  },
};

const toneClasses: Record<Tone, string> = {
  positive: "border-[var(--role-positive-border)] bg-[var(--role-positive-soft)] text-[var(--role-positive)]",
  information: "border-[var(--role-info-border)] bg-[var(--role-info-soft)] text-[var(--role-info)]",
  warning: "border-[var(--role-warning-border)] bg-[var(--role-warning-soft)] text-[var(--role-warning)]",
  failure: "border-[var(--role-failure-border)] bg-[var(--role-failure-soft)] text-[var(--role-failure)]",
  neutral: "border-[var(--border-strong)] bg-[var(--surface-raised)] text-[var(--text-muted)]",
};

function configFor(props: PostureBadgeProps): BadgeConfig {
  switch (props.dimension) {
    case "lifecycle":
      return lifecycle[props.value];
    case "maturity":
      return maturity[props.value];
    case "health":
      return health[props.value];
    case "evidence":
      return evidence[props.value];
  }
}

export function PostureBadge(props: PostureBadgeProps) {
  const config = configFor(props);
  const Icon = config.icon;

  return (
    <span
      data-dimension={props.dimension}
      className={`inline-flex min-h-7 items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium ${toneClasses[config.tone]}`}
    >
      <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
      <span>{config.label}</span>
    </span>
  );
}
