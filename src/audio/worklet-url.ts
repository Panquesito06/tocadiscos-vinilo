/**
 * URL absoluta de un procesador de AudioWorklet servido desde `public/worklets/`.
 *
 * Se resuelve contra `document.baseURI` partiendo de `import.meta.env.BASE_URL`
 * (con '/' final garantizada), nunca de una ruta absoluta `/worklets/...`: la
 * build usa `base: './'` y la app puede servirse desde cualquier carpeta.
 */
export function workletUrl(
  name: string,
  baseUrl: string = import.meta.env.BASE_URL,
  baseUri: string = document.baseURI,
): string {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const path = `${base}worklets/${name}.js`;
  try {
    return new URL(path, baseUri).href;
  } catch {
    // Sin una base válida (p. ej. `about:blank`), la ruta relativa sirve tal cual.
    return path;
  }
}
