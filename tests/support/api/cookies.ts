export function cookieValue(
  setCookie: string | string[] | undefined,
  name: string,
): string | undefined {
  const prefix = `${name}=`
  const cookies = typeof setCookie === 'string' ? [setCookie] : (setCookie ?? [])
  for (const cookie of cookies) {
    const first = cookie.split(';', 1)[0]
    if (first?.startsWith(prefix)) return decodeURIComponent(first.slice(prefix.length))
  }
  return undefined
}
