// The studio's avatar twin: the character options (src/avatar.js) and the asset allowlist (scripts/sync.mjs copies only
// these files to public/avatar-assets). Plain ESM, no imports. Same character as the bottle demo (webxr-demo/src/avatar-config.js;
// the allowlist logic is the demo's, kept in step until the character extensions of plan step 5 own it).
export const STUDIO_AVATAR = Object.freeze({ outfit: ['shirt', 'jeans', 'shoes'], hair: 'short02', sex: 'male', body: { height: 0 } });

/**
 * Asset files the character plugin fetches for this avatar, from the manifests in the plugin's assets folder:
 * body + joints sidecar, the manifests, the hair style, the outfit and the default underwear the plugin adds for the
 * sex when the outfit has none (clothing.json defaultUnderwear), and the license list.
 */
export function avatarAssetFiles({ hair, clothing }, avatar = STUDIO_AVATAR) {
  const files = new Set(['base_body.glb', 'base_body.joints.json', 'hair.json', 'clothing.json', 'asset_licenses.json', 'SYNCED.txt']);
  const style = hair?.styles?.find(s => s.id === (avatar.hair ?? hair.default));
  if (avatar.hair !== null && style?.file) files.add(style.file);
  const items = new Map((clothing?.items || []).map(it => [it.id, it]));
  const outfit = [...(avatar.outfit ?? clothing?.default ?? [])];
  const isUnderwear = id => (clothing?.underwearSlots ?? ['underwear']).includes(items.get(id)?.slot);
  if (!outfit.some(isUnderwear)) outfit.push(...(clothing?.defaultUnderwear?.[avatar.sex] ?? []));
  for (const id of outfit) {
    const it = items.get(id);
    if (!it) throw new Error(`Unknown clothing item in STUDIO_AVATAR: ${id}`);
    files.add(it.file);
  }
  return [...files];
}
