export const siteId = "site_0123456789abcdef";
export const otherSiteId = "site_abcdef0123456789";
export function settings(origin = "https://website.example", overrides = {}) {
  return {
    schema: "fonte.website.v1",
    siteId,
    revision: 1,
    enabled: true,
    origins: [origin],
    collection: {
      mode: "automatic",
      policy: {
        version: "website-test-v1",
        expiresAt: null,
        storage: "memory",
        routes: ["*"],
        clickIds: false,
        adCookies: false,
        sourceTokens: false,
      },
    },
    placements: [
      {
        key: "newsletter",
        presentation: "inline",
        paths: ["*"],
        form: {
          publicId: "12345678-1234-4234-8234-123456789abc",
          publishedRevision: 1,
          headline: "Updates",
          description: "Get updates",
          submitLabel: "Subscribe",
          successMessage: "Thanks",
          firstNameEnabled: true,
          confirmation: "single_opt_in",
          scopeLabel: "News",
        },
      },
    ],
    ...overrides,
  };
}
