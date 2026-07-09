"use client";

import { PublicErrorPanel } from "@/components/ui/PublicErrorPanel";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <PublicErrorPanel error={error} reset={reset} />;
}
