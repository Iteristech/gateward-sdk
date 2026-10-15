import { describe, it, expect } from "vitest";
import { GatewardAuth, GatewardError } from "../src/index.js";
import { GatewardServer } from "../src/server.js";
import { stubFetch, fakeAccessToken, type StubResponse } from "./helpers.js";

const BASE = "https://core.test";
const APP = "app-123";
const KEY = "gw_test_key";

const future = () => Math.floor(Date.now() / 1000) + 900;

const tokens = (): StubResponse => ({
  json: {
    access_token: fakeAccessToken(future()),
    refresh_token: "refresh-1",
    token_type: "Bearer",
    expires_in: 900,
  },
});

function client(responses: Parameters<typeof stubFetch>[0]) {
  const { fetch, calls } = stubFetch(responses);
  return { auth: new GatewardAuth({ baseUrl: BASE, appId: APP, fetch }), calls };
}

describe("registration by invitation", () => {
  it("sends the invite code and logs in when the Core returns tokens", async () => {
    const { auth, calls } = client([
      { status: 202, json: { message: "ok", ...tokens().json as object } },
    ]);
    await auth.register("ana@app.com", "pw", { inviteToken: "code-1" });
    expect(calls[0]!.body).toMatchObject({ email: "ana@app.com", invite_token: "code-1" });
    expect(await auth.getAccessToken()).toBeTruthy();
  });

  it("surfaces the reason an app refuses a walk-in", async () => {
    const { auth } = client([
      { status: 403, json: { error: "registration requires an invitation" } },
    ]);
    await expect(auth.register("ana@app.com", "pw")).rejects.toMatchObject({
      status: 403,
      message: expect.stringContaining("requires an invitation"),
    });
  });
});

describe("waiting list", () => {
  it("joins and confirms", async () => {
    const { auth, calls } = client([{ status: 202, json: { message: "ok" } }, { json: { status: "confirmed" } }]);
    await auth.joinWaitlist("ana@app.com", {
      metadata: { ref: "tw" },
      locale: "es-MX",
      consentSource: "landing",
    });
    await auth.confirmWaitlist("tok");
    expect(calls[0]!.url).toBe(`${BASE}/v1/waitlist`);
    expect(calls[0]!.headers["x-gateward-app-id"]).toBe(APP);
    expect(calls[0]!.body).toEqual({
      email: "ana@app.com",
      metadata: { ref: "tw" },
      locale: "es-MX",
      consent_source: "landing",
    });
    expect(calls[1]!.url).toBe(`${BASE}/v1/waitlist/confirm`);
    expect(calls[1]!.body).toEqual({ token: "tok" });
  });
});

describe("mailing lists", () => {
  it("subscribes, confirms and leaves without a session", async () => {
    const { auth, calls } = client([{ status: 202, json: {} }, { json: {} }, { json: {} }]);
    await auth.subscribeToList("news", "ana@app.com", { consentVersion: "2026-10" });
    await auth.confirmSubscription("c1");
    await auth.unsubscribeFromList("u/1");
    expect(calls[0]!.url).toBe(`${BASE}/v1/lists/news/subscribe`);
    expect(calls[0]!.body).toEqual({ email: "ana@app.com", consent_version: "2026-10" });
    expect(calls[1]!.body).toEqual({ token: "c1" });
    expect(calls[2]!.url).toBe(`${BASE}/v1/lists/unsubscribe/u%2F1`);
    expect(calls.every((c) => !c.headers.authorization)).toBe(true);
  });

  it("manages the signed-in user's subscriptions", async () => {
    const { auth, calls } = client([
      tokens(),
      { json: [{ slug: "news", name: "News", description: null, status: "none" }] },
      { json: { status: "subscribed" } },
    ]);
    await auth.login("ana@app.com", "pw");
    const subs = await auth.listSubscriptions();
    await auth.setSubscription("news", true);
    expect(subs[0]!.slug).toBe("news");
    expect(calls[1]!.method).toBe("GET");
    expect(calls[1]!.url).toBe(`${BASE}/v1/auth/me/subscriptions`);
    expect(calls[1]!.headers.authorization).toMatch(/^Bearer /);
    expect(calls[2]!).toMatchObject({ method: "PUT", body: { subscribed: true } });
  });
});

describe("contact forms", () => {
  it("reads a definition and posts values anonymously by default", async () => {
    const { auth, calls } = client([
      { json: { slug: "contact", name: "Contact", fields: [], access: "public", min_fill_seconds: 3 } },
      { status: 202, json: { received: true } },
    ]);
    const form = await auth.getForm("contact");
    await auth.submitForm("contact", { email: "a@b.co", agree: true }, { honeypot: "", startedAt: 123 });
    expect(form.slug).toBe("contact");
    expect(calls[1]!.url).toBe(`${BASE}/v1/forms/contact/submissions`);
    expect(calls[1]!.body).toEqual({ values: { email: "a@b.co", agree: true }, started_at: 123 });
    expect(calls[1]!.headers.authorization).toBeUndefined();
  });

  it("attaches the session when there is one, unless asked not to", async () => {
    const { auth, calls } = client([tokens(), { status: 202, json: {} }, { status: 202, json: {} }]);
    await auth.login("ana@app.com", "pw");
    await auth.submitForm("members", { message: "hi" });
    await auth.submitForm("members", { message: "hi" }, { anonymous: true });
    expect(calls[1]!.headers.authorization).toMatch(/^Bearer /);
    expect(calls[2]!.headers.authorization).toBeUndefined();
  });

  it("exposes every failing field on the error", async () => {
    const { auth } = client([
      {
        status: 400,
        json: { error: "validation failed", fields: { email: "not a valid email address", message: "required" } },
      },
    ]);
    const err = await auth.submitForm("contact", { email: "x" }).catch((e) => e);
    expect(err).toBeInstanceOf(GatewardError);
    expect(err.fieldErrors).toEqual({ email: "not a valid email address", message: "required" });
    expect(new GatewardError("boom", 500).fieldErrors).toBeUndefined();
  });
});

describe("GatewardServer access and messaging", () => {
  function server(responses: Parameters<typeof stubFetch>[0]) {
    const { fetch, calls } = stubFetch(responses);
    return { gw: new GatewardServer({ baseUrl: BASE, apiKey: KEY, fetch }), calls };
  }

  it("creates and revokes invitations with the API key", async () => {
    const { gw, calls } = server([{ json: [{ id: "i1", token: "code" }] }, { status: 204 }]);
    const made = await gw.createInvitations(APP, [{ email: "a@b.co", role: "app_admin" }], {
      sendEmail: false,
      expiresInDays: 3,
    });
    await gw.revokeInvitation(APP, "i1");
    expect(made[0]!.token).toBe("code");
    expect(calls[0]!.url).toBe(`${BASE}/v1/apps/${APP}/invitations`);
    expect(calls[0]!.headers["x-api-key"]).toBe(KEY);
    expect(calls[0]!.body).toEqual({
      invitations: [{ email: "a@b.co", role: "app_admin" }],
      expires_in_days: 3,
      send_email: false,
    });
    expect(calls[1]!).toMatchObject({ method: "DELETE" });
  });

  it("releases the waiting list by count and returns the released entries", async () => {
    const { gw, calls } = server([{ json: { released: [{ entry_id: "e1", email: "a@b.co", invitation_id: "i1", token: null }] } }]);
    const released = await gw.releaseWaitlist(APP, { count: 5, includeUnconfirmed: true });
    expect(released[0]!.entry_id).toBe("e1");
    expect(calls[0]!.url).toBe(`${BASE}/v1/apps/${APP}/waitlist/release`);
    expect(calls[0]!.body).toEqual({ count: 5, include_unconfirmed: true });
  });

  it("queues a notification, stores a template and broadcasts to a list", async () => {
    const { gw, calls } = server([
      { status: 202, json: { id: "n1", status: "pending" } },
      { json: { kind: "digest", locale: "en", subject: "s", body_text: "b", updated_at: "2026-10-15T00:00:00Z" } },
      { status: 202, json: { queued: 7 } },
    ]);
    const queued = await gw.sendNotification(APP, { to: "a@b.co", template: "digest", variables: { month: "Oct" } });
    await gw.putTemplate(APP, "digest", "en", { subject: "s", bodyText: "b" });
    const n = await gw.broadcast(APP, "news", { subject: "Hello", text: "Body" });
    expect(queued.status).toBe("pending");
    expect(calls[0]!.body).toEqual({ to: "a@b.co", template: "digest", variables: { month: "Oct" } });
    expect(calls[1]!).toMatchObject({
      method: "PUT",
      url: `${BASE}/v1/apps/${APP}/notification-templates/digest/en`,
      body: { subject: "s", body_text: "b" },
    });
    expect(n).toBe(7);
    expect(calls[2]!.url).toBe(`${BASE}/v1/apps/${APP}/lists/news/broadcasts`);
  });

  it("manages suppressions by address", async () => {
    const { gw, calls } = server([{ json: { suppressed: true, reason: "bounce" } }, { json: {} }, { status: 204 }]);
    const status = await gw.checkSuppression(APP, "a@b.co");
    await gw.addSuppression(APP, "a@b.co", "complaint");
    await gw.removeSuppression(APP, "a@b.co");
    expect(status.suppressed).toBe(true);
    expect(calls[0]!.url).toBe(`${BASE}/v1/apps/${APP}/suppressions?email=a%40b.co`);
    expect(calls[1]!.body).toEqual({ email: "a@b.co", reason: "complaint" });
    expect(calls[2]!).toMatchObject({ method: "DELETE", body: { email: "a@b.co" } });
  });

  it("defines a form and reads its inbox", async () => {
    const { gw, calls } = server([{ json: { slug: "contact" } }, { json: [] }, { json: { id: "s1", status: "replied" } }]);
    await gw.putForm(APP, "contact", {
      name: "Contact",
      fields: [{ name: "email", type: "email", required: true }],
      actions: [{ type: "notify_team", to: ["team@app.com"] }],
      minFillSeconds: 5,
      retentionDays: 90,
    });
    await gw.listSubmissions(APP, "contact", { status: "new", limit: 20 });
    await gw.updateSubmission(APP, "contact", "s1", "replied");
    expect(calls[0]!.method).toBe("PUT");
    expect(calls[0]!.body).toMatchObject({ name: "Contact", min_fill_seconds: 5, retention_days: 90 });
    expect(calls[1]!.url).toBe(`${BASE}/v1/apps/${APP}/forms/contact/submissions?status=new&limit=20`);
    expect(calls[2]!).toMatchObject({ method: "PATCH", body: { status: "replied" } });
  });
});
