import { fetchFrontendReleases } from "../releases"

const release = (id: number, tag_name: string, draft = false) => ({
  id,
  tag_name,
  draft,
  name: null,
  body: "Notes",
  prerelease: false,
  published_at: "2026-09-01T12:00:00Z",
})

describe("frontend releases", () => {
  const originalFetch = global.fetch
  afterEach(() => {
    global.fetch = originalFetch
  })

  it("continues past a full page of backend releases and includes RC releases", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () =>
          Array.from({ length: 100 }, (_, i) =>
            release(i, `backend-v1.0.${i}`)
          ),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          release(101, "frontend-v1.2.0-rc.1"),
          release(102, "frontend-v1.2.0", true),
        ],
      })
    global.fetch = fetchMock
    const result = await fetchFrontendReleases(new AbortController().signal)
    expect(result.success).toBe(true)
    expect(result.getValue()?.map((r) => r.id)).toEqual([101])
    expect(fetchMock.mock.calls[1][0]).toContain("page=2")
  })

  it("reports rate limiting as a failure", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 403 })
    const result = await fetchFrontendReleases(new AbortController().signal)
    expect(result.success).toBe(false)
  })
})
