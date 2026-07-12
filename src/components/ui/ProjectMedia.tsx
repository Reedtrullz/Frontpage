import Image from "next/image";
import { ImageOff } from "lucide-react";
import type { ProjectMedia as ProjectMediaContent } from "@/lib/content/schema";

interface ProjectMediaProps {
  media: ProjectMediaContent["cover"];
  priority?: boolean;
  showCaption?: boolean;
  sizes?: string;
}

export function ProjectMedia({
  media,
  priority = false,
  showCaption = false,
  sizes = "(min-width: 1024px) 50vw, 100vw",
}: ProjectMediaProps) {
  return (
    <figure>
      <div className="relative aspect-[16/10] overflow-hidden bg-[#07090a]">
        <Image
          src={media.src}
          alt={media.alt}
          width={media.width}
          height={media.height}
          priority={priority}
          sizes={sizes}
          className="h-full w-full object-contain"
        />
      </div>
      {showCaption && media.caption ? (
        <figcaption className="border-t border-[var(--border)] px-3 py-2 text-xs text-[var(--text-subtle)]">
          {media.caption}
        </figcaption>
      ) : null}
    </figure>
  );
}

export function ProjectMediaUnavailable({
  projectName,
}: {
  projectName: string;
}) {
  return (
    <div className="relative flex aspect-[16/10] flex-col justify-between overflow-hidden bg-[var(--surface-overlay)] p-5 sm:p-6">
      <div className="flex items-center justify-between gap-4">
        <span className="font-mono text-xs text-[var(--text-subtle)]">PROJECT RECORD</span>
        <ImageOff className="h-6 w-6 text-[var(--text-subtle)]" aria-hidden="true" />
      </div>
      <div className="relative max-w-sm">
        <p className="text-lg font-semibold text-[var(--text)]">{projectName}</p>
        <p className="mt-1 font-mono text-xs uppercase text-[var(--text-subtle)]">
          Media not published
        </p>
        <p className="mt-3 text-sm leading-6 text-[var(--text-muted)]">
          The project record remains available with scope, evidence, and limitations.
        </p>
      </div>
    </div>
  );
}
