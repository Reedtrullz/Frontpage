interface TechBadgeProps {
  tech: string;
}

export function TechBadge({ tech }: TechBadgeProps) {
  return (
    <span className="inline-block px-2.5 py-0.5 rounded border border-zinc-800 bg-zinc-900 text-xs text-zinc-300 font-mono">
      {tech}
    </span>
  );
}
