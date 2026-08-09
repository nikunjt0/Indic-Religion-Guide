import type { MetadataRoute } from "next";

const BASE_URL =
  process.env.PUBLIC_APP_URL ?? process.env.APP_PUBLIC_URL ?? "https://example.com";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // /q/* are private shared conversations (noindexed and excluded);
        // the rest are app/auth surfaces with no search value.
        disallow: ["/q/", "/api/", "/chats", "/profile", "/ask", "/sign-in"],
      },
    ],
    sitemap: `${BASE_URL.replace(/\/$/, "")}/sitemap.xml`,
  };
}
