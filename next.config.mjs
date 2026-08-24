/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: { bodySizeLimit: "25mb" },
  },
  // pdf-parse (pdfjs internals) and tesseract.js (worker/WASM loading) both
  // break under webpack's server bundling in different ways — pdf-parse's
  // module-scope debug-mode check misfires, and pdfjs's internal dynamic
  // requires choke on webpack's require-context wrapping ("Command token too
  // long" — a content-stream tokenizer error that only appears bundled, not
  // running the same file through plain Node). Excluding them from the
  // server bundle restores normal Node require() semantics for both.
  // pdfkit resolves its standard-font .afm files via a path relative to its
  // own package directory at runtime — webpack's bundling relocates the
  // module without those data files, so the same fix applies here too.
  serverExternalPackages: ["pdf-parse", "tesseract.js", "pdfkit"],
};

export default nextConfig;
