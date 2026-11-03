// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

import { GatewardAuth } from "../src/index.js";
import {
  GatewardProvider,
  useForm,
  useSubscription,
  useSubscriptions,
  useWaitlist,
} from "../src/react.js";
import { stubFetch, fakeAccessToken, type StubResponse } from "./helpers.js";

const BASE = "https://core.test";
const APP = "app-123";
const future = () => Math.floor(Date.now() / 1000) + 900;

const meResponse: StubResponse = {
  json: {
    user_id: "user-1", email: "ana@app.com", email_verified: true, account_status: "active",
    actor_kind: "human", app_id: APP, membership_role: "member", scopes: [], metadata: {},
    created_at: "2026-08-01T00:00:00Z",
  },
};

function wrapperFor(responses: Parameters<typeof stubFetch>[0]) {
  const { fetch, calls } = stubFetch(responses);
  const auth = new GatewardAuth({ baseUrl: BASE, appId: APP, fetch });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <GatewardProvider auth={auth}>{children}</GatewardProvider>
  );
  return { Wrapper, calls, auth };
}

afterEach(cleanup);

describe("useWaitlist", () => {
  it("tracks a request and reports success as a boolean", async () => {
    const { Wrapper, calls } = wrapperFor([{ status: 202, json: {} }]);
    const { result } = renderHook(() => useWaitlist(), { wrapper: Wrapper });
    expect(result.current.status).toBe("idle");

    let ok = false;
    await act(async () => {
      ok = await result.current.join("ana@app.com", { consentSource: "landing" });
    });
    expect(ok).toBe(true);
    expect(result.current.status).toBe("done");
    expect(calls.at(-1)!.url).toBe(`${BASE}/v1/waitlist`);
  });

  it("reports a failure without throwing", async () => {
    const { Wrapper } = wrapperFor([{ status: 403, json: { error: "waitlist is not enabled" } }]);
    const { result } = renderHook(() => useWaitlist(), { wrapper: Wrapper });
    let ok = true;
    await act(async () => {
      ok = await result.current.join("ana@app.com");
    });
    expect(ok).toBe(false);
    expect(result.current.status).toBe("error");
    expect(result.current.error?.message).toContain("waitlist is not enabled");
    act(() => result.current.reset());
    expect(result.current.status).toBe("idle");
  });
});

describe("useSubscription", () => {
  it("subscribes to the named list", async () => {
    const { Wrapper, calls } = wrapperFor([{ status: 202, json: {} }]);
    const { result } = renderHook(() => useSubscription("news"), { wrapper: Wrapper });
    await act(async () => {
      await result.current.subscribe("ana@app.com");
    });
    expect(calls.at(-1)!.url).toBe(`${BASE}/v1/lists/news/subscribe`);
    expect(result.current.status).toBe("done");
  });
});

describe("useForm", () => {
  const definition: StubResponse = {
    json: { slug: "contact", name: "Contact", fields: [{ name: "email", type: "email", required: true }], access: "public", min_fill_seconds: 3 },
  };

  it("loads the definition, then posts with the time it was shown", async () => {
    const { Wrapper, calls } = wrapperFor([definition, { status: 202, json: { received: true } }]);
    const { result } = renderHook(() => useForm("contact"), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.form?.slug).toBe("contact"));
    expect(result.current.loading).toBe(false);

    await act(async () => {
      await result.current.submit({ email: "a@b.co" }, { honeypot: "" });
    });
    const post = calls.at(-1)!;
    expect(post.url).toBe(`${BASE}/v1/forms/contact/submissions`);
    expect((post.body as { started_at: number }).started_at).toBeGreaterThan(0);
  });

  it("exposes every failing field", async () => {
    const { Wrapper } = wrapperFor([
      definition,
      { status: 400, json: { error: "validation failed", fields: { email: "required" } } },
    ]);
    const { result } = renderHook(() => useForm("contact"), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.form).not.toBeNull());
    await act(async () => {
      await result.current.submit({});
    });
    expect(result.current.fieldErrors).toEqual({ email: "required" });
    expect(result.current.status).toBe("error");
  });
});

describe("useSubscriptions", () => {
  it("stays empty while signed out", async () => {
    const { Wrapper } = wrapperFor([]);
    const { result } = renderHook(() => useSubscriptions(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.status).toBe("idle"));
    expect(result.current.lists).toBeNull();
  });

  it("loads the lists once signed in and re-reads after a change", async () => {
    const list = (status: string) => ({ json: [{ slug: "news", name: "News", description: null, status }] });
    const { Wrapper, auth } = wrapperFor([
      { json: { access_token: fakeAccessToken(future()), refresh_token: "r", token_type: "Bearer", expires_in: 900 } },
      meResponse,
      list("none"),
      { json: { status: "subscribed" } },
      list("subscribed"),
    ]);
    const { result } = renderHook(() => useSubscriptions(), { wrapper: Wrapper });
    await act(async () => {
      await auth.login("ana@app.com", "pw");
    });
    await waitFor(() => expect(result.current.lists?.[0]?.status).toBe("none"));
    await act(async () => {
      await result.current.set("news", true);
    });
    await waitFor(() => expect(result.current.lists?.[0]?.status).toBe("subscribed"));
  });
});
