import type { MetadataRoute } from "next";

/** Private jury demo: nothing on this site should be indexed. */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: "/" } };
}
