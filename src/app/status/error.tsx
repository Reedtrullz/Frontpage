"use client";

import { PublicErrorPanel } from "@/components/ui/PublicErrorPanel";

export default function StatusError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <PublicErrorPanel error={error} reset={reset} scope="status" />;
}
