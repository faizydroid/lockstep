import type { NextConfig } from "next";

const config: NextConfig = {
  // Every page here is a read view over chain state, so nothing needs a Node server at
  // runtime. Exporting static files means the demo can be served from anywhere and cannot
  // fall over mid-presentation because a server process died.
  output: "export",

  // Chain reads happen in the browser against a public RPC, so there is no image
  // optimisation server either.
  images: { unoptimized: true },

  typedRoutes: true,
};

export default config;
