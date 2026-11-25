import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Nigeria State Monitor",
    short_name: "NSM",
    description: "Geographic and regional situational awareness for Nigeria's 36 states and the FCT.",
    start_url: "/",
    display: "standalone",
    background_color: "#05070f",
    theme_color: "#05070f",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
