/** Compare release versions, including the rc.N versions produced by CI. */
export function compareReleaseVersions(
  left: string,
  right: string
): number | null {
  const parse = (value: string) =>
    /^(?:frontend-v)?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(
      value
    )
  const a = parse(left)
  const b = parse(right)
  if (!a || !b) return null
  for (let i = 1; i <= 3; i++) {
    const difference = Number(a[i]) - Number(b[i])
    if (difference) return Math.sign(difference)
  }
  if (!a[4] || !b[4]) return a[4] ? -1 : b[4] ? 1 : 0
  const ap = a[4].split(".")
  const bp = b[4].split(".")
  for (let i = 0; i < Math.max(ap.length, bp.length); i++) {
    if (ap[i] === undefined) return -1
    if (bp[i] === undefined) return 1
    if (ap[i] === bp[i]) continue
    const an = /^\d+$/.test(ap[i])
    const bn = /^\d+$/.test(bp[i])
    if (an && bn) return Math.sign(Number(ap[i]) - Number(bp[i]))
    if (an !== bn) return an ? -1 : 1
    return ap[i] < bp[i] ? -1 : 1
  }
  return 0
}
