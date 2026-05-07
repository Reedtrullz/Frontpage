"use client";

import { TypingText } from "@/components/ui/TypingText";
import type { PersonalData } from "@/data/personal";

interface HeroProps {
  personal: PersonalData;
}

const phrases = [
  "Full-Stack Developer",
  "DeFi Builder",
  "THORChain Enthusiast",
  "Automation Addict",
  "Open Source Contributor",
];

export function Hero({ personal }: HeroProps) {
  return (
    <section className="py-24 px-6 max-w-3xl mx-auto">
      <p className="font-mono text-green-500 text-sm mb-4">
        <TypingText phrases={phrases} />
      </p>
      <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-zinc-100 mb-4">
        {personal.name}
      </h1>
      <p className="text-lg text-zinc-400 max-w-xl leading-relaxed">
        {personal.bio}
      </p>
    </section>
  );
}
