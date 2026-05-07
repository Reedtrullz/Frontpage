import type { SocialLink } from "@/data/personal";

interface FooterProps {
  name: string;
  socials: SocialLink[];
}

export function Footer({ name, socials }: FooterProps) {
  return (
    <footer className="border-t border-zinc-800 mt-auto">
      <div className="max-w-5xl mx-auto px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-zinc-500">
        <span>&copy; {new Date().getFullYear()} {name}</span>
        <div className="flex items-center gap-4">
          {socials.map((s) => (
            <a
              key={s.label}
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-zinc-300 transition-colors"
            >
              {s.label}
            </a>
          ))}
        </div>
      </div>
    </footer>
  );
}
