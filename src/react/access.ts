import { useCallback, useEffect, useRef, useState } from "react";

import type { JoinWaitlistOptions } from "../core/access.js";
import { GatewardError } from "../core/errors.js";
import type { SubmitFormOptions } from "../core/forms.js";
import type { SubscribeOptions } from "../core/messaging.js";
import type { MySubscription, PublicForm } from "../core/types.js";
import { useAuth } from "./context.js";

// Hooks for the pieces that need no account: the waiting list, mailing lists
// and contact forms. They hold the state of a request (sending, failed, done)
// and nothing else. They never return JSX: the app draws its own inputs.

export type RequestStatus = "idle" | "pending" | "done" | "error";

export interface RequestState {
  status: RequestStatus;
  /** The last failure, cleared when the next request starts. */
  error: Error | null;
  /** Per-field messages when the Core rejected a form post. */
  fieldErrors: Record<string, string>;
  reset(): void;
}

/** Runs one request at a time and tracks it. `track` resolves `true` on
 *  success and `false` on failure instead of throwing, so an event handler
 *  can `if (await join(email)) …` with no try/catch. */
function useRequestState(): RequestState & {
  track(work: () => Promise<unknown>): Promise<boolean>;
} {
  const [status, setStatus] = useState<RequestStatus>("idle");
  const [error, setError] = useState<Error | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const track = useCallback(async (work: () => Promise<unknown>) => {
    setStatus("pending");
    setError(null);
    setFieldErrors({});
    try {
      await work();
      if (alive.current) setStatus("done");
      return true;
    } catch (e) {
      if (alive.current) {
        setError(e instanceof Error ? e : new Error(String(e)));
        setFieldErrors(e instanceof GatewardError ? (e.fieldErrors ?? {}) : {});
        setStatus("error");
      }
      return false;
    }
  }, []);

  const reset = useCallback(() => {
    setStatus("idle");
    setError(null);
    setFieldErrors({});
  }, []);

  return { status, error, fieldErrors, reset, track };
}

export interface UseWaitlist extends RequestState {
  join(email: string, opts?: JoinWaitlistOptions): Promise<boolean>;
  confirm(token: string): Promise<boolean>;
}

/** Join the app's waiting list and confirm the place from the emailed code. */
export function useWaitlist(): UseWaitlist {
  const { auth } = useAuth();
  const { track, ...state } = useRequestState();
  return {
    ...state,
    join: (email, opts) => track(() => auth.joinWaitlist(email, opts)),
    confirm: (token) => track(() => auth.confirmWaitlist(token)),
  };
}

export interface UseSubscription extends RequestState {
  subscribe(email: string, opts?: SubscribeOptions): Promise<boolean>;
  confirm(token: string): Promise<boolean>;
  unsubscribe(token: string): Promise<boolean>;
}

/** One mailing list, for visitors without an account. */
export function useSubscription(list: string): UseSubscription {
  const { auth } = useAuth();
  const { track, ...state } = useRequestState();
  return {
    ...state,
    subscribe: (email, opts) => track(() => auth.subscribeToList(list, email, opts)),
    confirm: (token) => track(() => auth.confirmSubscription(token)),
    unsubscribe: (token) => track(() => auth.unsubscribeFromList(token)),
  };
}

export interface UseSubscriptions extends RequestState {
  /** The app's lists with the signed-in user's state on each; `null` until loaded. */
  lists: MySubscription[] | null;
  set(list: string, subscribed: boolean): Promise<boolean>;
  refresh(): Promise<boolean>;
}

/** The signed-in user's preferences across the app's lists. Loads once the
 *  session is authenticated. */
export function useSubscriptions(): UseSubscriptions {
  const { auth, isAuthenticated } = useAuth();
  const { track, ...state } = useRequestState();
  const [lists, setLists] = useState<MySubscription[] | null>(null);

  const refresh = useCallback(
    () => track(async () => setLists(await auth.listSubscriptions())),
    [auth, track],
  );

  useEffect(() => {
    if (isAuthenticated) void refresh();
    else setLists(null);
  }, [isAuthenticated, refresh]);

  return {
    ...state,
    lists,
    refresh,
    set: async (list, subscribed) => {
      const ok = await track(() => auth.setSubscription(list, subscribed));
      if (ok) setLists(await auth.listSubscriptions().catch(() => lists));
      return ok;
    },
  };
}

export interface UseForm extends RequestState {
  /** The definition to draw; `null` while loading or if it failed to load. */
  form: PublicForm | null;
  loading: boolean;
  /** Posts the values. The time the form was shown is sent for you. */
  submit(
    values: Record<string, string | boolean>,
    opts?: Omit<SubmitFormOptions, "bearer" | "startedAt"> & { anonymous?: boolean },
  ): Promise<boolean>;
}

/** A contact form: loads its definition and posts the values. A rejected post
 *  leaves `fieldErrors` naming every failing field. */
export function useForm(slug: string): UseForm {
  const { auth } = useAuth();
  const { track, ...state } = useRequestState();
  const [form, setForm] = useState<PublicForm | null>(null);
  const [loading, setLoading] = useState(true);
  const shownAt = useRef(Date.now());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setForm(null);
    auth
      .getForm(slug)
      .then((f) => {
        if (cancelled) return;
        shownAt.current = Date.now();
        setForm(f);
      })
      .catch((e) => {
        if (!cancelled) void track(() => Promise.reject(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [auth, slug, track]);

  return {
    ...state,
    form,
    loading,
    submit: (values, opts) =>
      track(() => auth.submitForm(slug, values, { ...opts, startedAt: shownAt.current })),
  };
}
