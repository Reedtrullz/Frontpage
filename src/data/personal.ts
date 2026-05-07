export interface SocialLink {
  label: string;
  url: string;
}

export interface PersonalData {
  name: string;
  title: string;
  location: string;
  bio: string;
  whatIDo: string[];
  skills: string[];
  socials: SocialLink[];
}

export const personal: PersonalData = {
  name: "Reidar",
  title: "Full-Stack Developer & DeFi Builder",
  location: "Norway",
  bio: "I build web applications, trading infrastructure, and DeFi tooling — mostly around THORChain and cross-chain liquidity. I like systems that work without babysitting.",
  whatIDo: [
    "Design and build full-stack web apps with Next.js, TypeScript, and Tailwind",
    "Create trading bots and arbitrage systems for DeFi protocols",
    "Build monitoring dashboards and data visualizations for blockchain networks",
    "Develop Discord bots and automation tools for community infrastructure",
  ],
  skills: [
    "TypeScript",
    "Next.js",
    "React",
    "Tailwind CSS",
    "Node.js",
    "Solidity",
    "THORChain",
    "DeFi",
    "Ethereum",
    "Puppeteer",
    "Discord.js",
    "SQL",
  ],
  socials: [
    { label: "GitHub", url: "https://github.com/Reedtrullz" },
    { label: "Twitter", url: "https://x.com/Reedtrullz" },
  ],
};
