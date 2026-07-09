"use client";

import { PublicErrorPanel } from "@/components/ui/PublicErrorPanel";

export default function ProjectError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <PublicErrorPanel error={error} reset={reset} scope="projects" />;
}
