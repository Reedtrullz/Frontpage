export type PublicErrorScope = "default" | "projects" | "status";

interface PublicErrorCopy {
  eyebrow: string;
  title: string;
  description: string;
}

const copyByScope: Record<PublicErrorScope, PublicErrorCopy> = {
  default: {
    eyebrow: "Request interrupted",
    title: "This page could not finish loading.",
    description: "Try again. You can also return home and continue from there.",
  },
  projects: {
    eyebrow: "Projects unavailable",
    title: "The project view could not be loaded.",
    description: "Try again in a moment. Published project data remains unchanged.",
  },
  status: {
    eyebrow: "Status unavailable",
    title: "Current status could not be loaded.",
    description: "Try again in a moment. Missing telemetry is not treated as healthy.",
  },
};

export function getPublicErrorCopy(
  scope: PublicErrorScope,
  error?: unknown,
): PublicErrorCopy {
  void error;
  return copyByScope[scope];
}
