import type { HttpClient, RequestOptions } from "./http.js";
import type {
  MailingList,
  NotificationRecord,
  NotificationTemplate,
  QueuedNotification,
  Subscriber,
  SuppressionStatus,
} from "./types.js";

// Mailing lists, notifications and templates. Headless: the app draws its
// own subscribe box and preferences page.

export interface SubscribeOptions {
  locale?: string;
  /** Where the address was collected; kept as the consent record. */
  consentSource?: string;
  /** Which privacy notice or wording the person agreed to. */
  consentVersion?: string;
}

/** Resolves the same way whether or not the address was already subscribed.
 *  On a double opt-in list the person must still confirm from their inbox. */
export async function subscribe(
  http: HttpClient,
  list: string,
  email: string,
  opts: SubscribeOptions = {},
): Promise<void> {
  await http.request<unknown>("POST", `/v1/lists/${list}/subscribe`, {
    body: {
      email,
      ...(opts.locale ? { locale: opts.locale } : {}),
      ...(opts.consentSource ? { consent_source: opts.consentSource } : {}),
      ...(opts.consentVersion ? { consent_version: opts.consentVersion } : {}),
    },
  });
}

export async function confirmSubscription(
  http: HttpClient,
  token: string,
): Promise<void> {
  await http.request<unknown>("POST", "/v1/lists/confirm", { body: { token } });
}

/** One-click leave with the token every broadcast carries. Needs no login. */
export async function unsubscribe(
  http: HttpClient,
  token: string,
): Promise<void> {
  await http.request<unknown>(
    "POST",
    `/v1/lists/unsubscribe/${encodeURIComponent(token)}`,
  );
}

// ---- Server side (API key) ---------------------------------------------

export interface SendNotificationInput {
  to: string;
  /** A stored template's name, filled with `variables`. Or give `subject`
   *  and `text` instead — exactly one of the two. */
  template?: string;
  locale?: string;
  variables?: Record<string, unknown>;
  subject?: string;
  text?: string;
  /** `transactional` (default) or `broadcast`: which providers may carry it. */
  purpose?: "transactional" | "broadcast";
}

/** Queues a message; the Core's worker delivers it through the app's
 *  providers with retries. Poll {@link getNotification} for the outcome. */
export function sendNotification(
  http: HttpClient,
  auth: RequestOptions,
  appId: string,
  input: SendNotificationInput,
): Promise<QueuedNotification> {
  return http.request<QueuedNotification>(
    "POST",
    `/v1/apps/${appId}/notifications`,
    {
      ...auth,
      body: {
        to: input.to,
        ...(input.template ? { template: input.template } : {}),
        ...(input.locale ? { locale: input.locale } : {}),
        ...(input.variables ? { variables: input.variables } : {}),
        ...(input.subject !== undefined ? { subject: input.subject } : {}),
        ...(input.text !== undefined ? { text: input.text } : {}),
        ...(input.purpose ? { purpose: input.purpose } : {}),
      },
    },
  );
}

export function listNotifications(
  http: HttpClient,
  auth: RequestOptions,
  appId: string,
  query: { status?: "pending" | "sending" | "sent" | "failed" | "skipped" } = {},
): Promise<NotificationRecord[]> {
  return http.request<NotificationRecord[]>(
    "GET",
    `/v1/apps/${appId}/notifications`,
    { ...auth, query: { status: query.status } },
  );
}

export function getNotification(
  http: HttpClient,
  auth: RequestOptions,
  appId: string,
  id: string,
): Promise<NotificationRecord> {
  return http.request<NotificationRecord>(
    "GET",
    `/v1/apps/${appId}/notifications/${id}`,
    auth,
  );
}

export function listTemplates(
  http: HttpClient,
  auth: RequestOptions,
  appId: string,
): Promise<NotificationTemplate[]> {
  return http.request<NotificationTemplate[]>(
    "GET",
    `/v1/apps/${appId}/notification-templates`,
    auth,
  );
}

/** A template named after an authentication kind (`verification`,
 *  `password_reset`, `email_change`, `invitation`, `waitlist_confirm`,
 *  `list_confirm`) replaces that email's wording and must contain `{{token}}`.
 *  Any other name is one you send by name. */
export function putTemplate(
  http: HttpClient,
  auth: RequestOptions,
  appId: string,
  kind: string,
  locale: string,
  template: { subject: string; bodyText: string },
): Promise<NotificationTemplate> {
  return http.request<NotificationTemplate>(
    "PUT",
    `/v1/apps/${appId}/notification-templates/${kind}/${locale}`,
    {
      ...auth,
      body: { subject: template.subject, body_text: template.bodyText },
    },
  );
}

export async function deleteTemplate(
  http: HttpClient,
  auth: RequestOptions,
  appId: string,
  kind: string,
  locale: string,
): Promise<void> {
  await http.request<void>(
    "DELETE",
    `/v1/apps/${appId}/notification-templates/${kind}/${locale}`,
    auth,
  );
}

export interface CreateMailingListInput {
  /** Lowercase letters, digits and hyphens, up to 40. */
  slug: string;
  name: string;
  description?: string;
  /** Default true. */
  doubleOptIn?: boolean;
  /** Where a broadcast's unsubscribe link points; `{token}` is replaced. */
  unsubscribeUrl?: string;
}

export function listMailingLists(
  http: HttpClient,
  auth: RequestOptions,
  appId: string,
): Promise<MailingList[]> {
  return http.request<MailingList[]>("GET", `/v1/apps/${appId}/lists`, auth);
}

export function createMailingList(
  http: HttpClient,
  auth: RequestOptions,
  appId: string,
  input: CreateMailingListInput,
): Promise<MailingList> {
  return http.request<MailingList>("POST", `/v1/apps/${appId}/lists`, {
    ...auth,
    body: {
      slug: input.slug,
      name: input.name,
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.doubleOptIn !== undefined ? { double_opt_in: input.doubleOptIn } : {}),
      ...(input.unsubscribeUrl ? { unsubscribe_url: input.unsubscribeUrl } : {}),
    },
  });
}

export function updateMailingList(
  http: HttpClient,
  auth: RequestOptions,
  appId: string,
  slug: string,
  patch: Partial<Omit<CreateMailingListInput, "slug">> & {
    status?: "active" | "archived";
  },
): Promise<MailingList> {
  return http.request<MailingList>("PATCH", `/v1/apps/${appId}/lists/${slug}`, {
    ...auth,
    body: {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.doubleOptIn !== undefined ? { double_opt_in: patch.doubleOptIn } : {}),
      ...(patch.unsubscribeUrl !== undefined
        ? { unsubscribe_url: patch.unsubscribeUrl }
        : {}),
      ...(patch.status ? { status: patch.status } : {}),
    },
  });
}

/** Erases the list and all its subscribers. */
export async function deleteMailingList(
  http: HttpClient,
  auth: RequestOptions,
  appId: string,
  slug: string,
): Promise<void> {
  await http.request<void>("DELETE", `/v1/apps/${appId}/lists/${slug}`, auth);
}

export function listSubscribers(
  http: HttpClient,
  auth: RequestOptions,
  appId: string,
  slug: string,
  query: {
    status?: "pending" | "subscribed" | "unsubscribed";
    limit?: number;
    offset?: number;
  } = {},
): Promise<Subscriber[]> {
  return http.request<Subscriber[]>(
    "GET",
    `/v1/apps/${appId}/lists/${slug}/subscribers`,
    {
      ...auth,
      query: { status: query.status, limit: query.limit, offset: query.offset },
    },
  );
}

export async function deleteSubscriber(
  http: HttpClient,
  auth: RequestOptions,
  appId: string,
  slug: string,
  id: string,
): Promise<void> {
  await http.request<void>(
    "DELETE",
    `/v1/apps/${appId}/lists/${slug}/subscribers/${id}`,
    auth,
  );
}

export interface BroadcastInput {
  /** A stored template's name; or `subject` and `text` — exactly one. The
   *  per-person `{{email}}` and `{{unsubscribe_url}}` are always available. */
  template?: string;
  locale?: string;
  variables?: Record<string, unknown>;
  subject?: string;
  text?: string;
}

/** One message per active, unsuppressed subscriber (up to 5000 per call and
 *  20 000 per day). Every message carries the recipient's unsubscribe link.
 *  Returns how many were queued. */
export async function broadcast(
  http: HttpClient,
  auth: RequestOptions,
  appId: string,
  slug: string,
  input: BroadcastInput,
): Promise<number> {
  const res = await http.request<{ queued: number }>(
    "POST",
    `/v1/apps/${appId}/lists/${slug}/broadcasts`,
    {
      ...auth,
      body: {
        ...(input.template ? { template: input.template } : {}),
        ...(input.locale ? { locale: input.locale } : {}),
        ...(input.variables ? { variables: input.variables } : {}),
        ...(input.subject !== undefined ? { subject: input.subject } : {}),
        ...(input.text !== undefined ? { text: input.text } : {}),
      },
    },
  );
  return res.queued;
}

export function checkSuppression(
  http: HttpClient,
  auth: RequestOptions,
  appId: string,
  email: string,
): Promise<SuppressionStatus> {
  return http.request<SuppressionStatus>(
    "GET",
    `/v1/apps/${appId}/suppressions`,
    { ...auth, query: { email } },
  );
}

/** Blocks broadcasts to the address, whatever list it is on. Only a hash of
 *  it is kept. */
export async function addSuppression(
  http: HttpClient,
  auth: RequestOptions,
  appId: string,
  email: string,
  reason: "manual" | "bounce" | "complaint" = "manual",
): Promise<void> {
  await http.request<unknown>("POST", `/v1/apps/${appId}/suppressions`, {
    ...auth,
    body: { email, reason },
  });
}

export async function removeSuppression(
  http: HttpClient,
  auth: RequestOptions,
  appId: string,
  email: string,
): Promise<void> {
  await http.request<void>("DELETE", `/v1/apps/${appId}/suppressions`, {
    ...auth,
    body: { email },
  });
}
