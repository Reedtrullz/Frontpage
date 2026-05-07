import { TechBadge } from "@/components/ui/TechBadge";
import type { PersonalData } from "@/data/personal";

interface AboutProps {
  personal: PersonalData;
}

export function About({ personal }: AboutProps) {
  return (
    <section className="py-16 px-6 max-w-3xl mx-auto border-t border-zinc-800">
      <h2 className="font-mono text-sm text-green-500 mb-8">What I Do</h2>

      <div className="grid sm:grid-cols-2 gap-4 mb-10">
        {personal.whatIDo.map((item) => (
          <div
            key={item}
            className="flex items-start gap-3 text-sm text-zinc-400"
          >
            <span className="text-green-500 mt-0.5 shrink-0">▸</span>
            <span>{item}</span>
          </div>
        ))}
      </div>

      <h2 className="font-mono text-sm text-green-500 mb-4">Skills</h2>
      <div className="flex flex-wrap gap-2">
        {personal.skills.map((skill) => (
          <TechBadge key={skill} tech={skill} />
        ))}
      </div>
    </section>
  );
}
