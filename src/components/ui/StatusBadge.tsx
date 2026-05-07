import type { ProjectStatus } from "@/data/projects";

const statusConfig: Record<
  ProjectStatus,
  { color: string; label: string }
> = {
  active: { color: "bg-green-500", label: "Active" },
  "in-progress": { color: "bg-amber-500", label: "In Progress" },
  completed: { color: "bg-blue-500", label: "Completed" },
  paused: { color: "bg-zinc-500", label: "Paused" },
};

interface StatusBadgeProps {
  status: ProjectStatus;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const config = statusConfig[status];

  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-mono text-zinc-400">
      <span className={`inline-block w-2 h-2 rounded-full ${config.color}`} />
      {config.label}
    </span>
  );
}
