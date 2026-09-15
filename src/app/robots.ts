import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", "/ansible", "/api"],
    },
    sitemap: "https://reidar.tech/sitemap.xml",
  };
}
