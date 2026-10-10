// Resolve runtime assets beside index.html, including when hosted in a subdirectory.
export function assetUrl(path) {
  return new URL(`assets/${path.replace(/^\/+/, '')}`, document.baseURI).href;
}
