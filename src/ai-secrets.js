const encoder = new TextEncoder();
async function encryptionKey(env) {
  if (!env.AI_KEY_SECRET) throw new Error('Máy chủ chưa cấu hình mã hóa khóa AI.');
  return crypto.subtle.importKey('raw', await crypto.subtle.digest('SHA-256', encoder.encode(env.AI_KEY_SECRET)), 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function seal(env, owner, secret) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({name:'AES-GCM', iv, additionalData:encoder.encode(owner)}, await encryptionKey(env), encoder.encode(secret));
  return btoa(String.fromCharCode(...iv, ...new Uint8Array(encrypted)));
}
export async function unseal(env, owner, ciphertext) {
  try {
    const bytes = Uint8Array.from(atob(ciphertext), value => value.charCodeAt(0));
    return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM', iv:bytes.slice(0,12), additionalData:encoder.encode(owner)}, await encryptionKey(env), bytes.slice(12)));
  } catch { return null; }
}
