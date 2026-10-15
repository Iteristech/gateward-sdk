import {
  HttpClient,
  type RequestHooks,
  type RetryOptions,
} from "./core/http.js";
import {
  getMember,
  listMembers,
  setMemberRole,
  type ListMembersQuery as MembersQuery,
  type MemberPage,
} from "./core/members.js";
import {
  createInvitations,
  deleteWaitlistEntry,
  listInvitations,
  listWaitlist,
  releaseWaitlist,
  resendInvitation,
  revokeInvitation,
  waitlistStats,
  type CreateInvitationsOptions,
  type InvitationInput,
  type ListWaitlistQuery,
  type ReleaseWaitlistInput,
} from "./core/access.js";
import {
  deleteForm,
  deleteSubmission,
  getFormDefinition,
  getSubmission,
  listForms,
  listSubmissions,
  putForm,
  updateSubmission,
  type PutFormInput,
  type SubmissionStatus,
} from "./core/forms.js";
import {
  addSuppression,
  broadcast,
  checkSuppression,
  createMailingList,
  deleteMailingList,
  deleteSubscriber,
  deleteTemplate,
  getNotification,
  listMailingLists,
  listNotifications,
  listSubscribers,
  listTemplates,
  putTemplate,
  removeSuppression,
  sendNotification,
  updateMailingList,
  type BroadcastInput,
  type CreateMailingListInput,
  type SendNotificationInput,
} from "./core/messaging.js";
import { JwtVerifier } from "./jwt/verify.js";
import type {
  CreatedInvitation,
  FormDefinition,
  FormSubmission,
  Invitation,
  MailingList,
  NotificationRecord,
  NotificationTemplate,
  QueuedNotification,
  ReleasedEntry,
  Subscriber,
  SuppressionStatus,
  WaitlistEntry,
  WaitlistStats,
  EventRecord,
  FetchLike,
  GatewardClaims,
  MembershipResponse,
  MembershipRole,
} from "./core/types.js";

export interface GatewardServerOptions {
  baseUrl: string;
  /** Service-account API key, sent as `X-API-Key`. */
  apiKey: string;
  /** App id, sent as `X-Gateward-App-Id` when set. */
  appId?: string;
  /** Observability hooks (onRequest/onResponse/onError/onRetry). */
  hooks?: RequestHooks;
  /** Automatic retry (idempotency-aware). `true` for defaults. */
  retry?: RetryOptions | boolean;
  /** Custom fetch (defaults to global `fetch`). */
  fetch?: FetchLike;
  /** Expected token issuer for {@link verifyToken} (recommended). */
  issuer?: string;
}

export interface SendEventInput {
  /** Namespaced event type, e.g. `app.checkout.completed` (must contain a `.`). */
  eventType: string;
  /** Optional user the event is about — must be in the key's identity pool. */
  userId?: string;
  metadata?: Record<string, unknown>;
}

export interface ListEventsQuery {
  eventType?: string;
  userId?: string;
  limit?: number;
  offset?: number;
}

/** Server-to-server client authenticated by an API key. Emits events
 *  (`events:write`), reads them (`events:read_app`), and verifies access
 *  tokens locally via JWKS — no per-verify round-trip to the Core. */
export class GatewardServer {
  private readonly http: HttpClient;
  private readonly apiKey: string;
  private readonly verifier: JwtVerifier;

  constructor(opts: GatewardServerOptions) {
    this.http = new HttpClient({
      baseUrl: opts.baseUrl,
      ...(opts.appId ? { appId: opts.appId } : {}),
      ...(opts.hooks ? { hooks: opts.hooks } : {}),
      ...(opts.retry !== undefined ? { retry: opts.retry } : {}),
      ...(opts.fetch ? { fetch: opts.fetch } : {}),
    });
    this.apiKey = opts.apiKey;
    this.verifier = new JwtVerifier({
      baseUrl: opts.baseUrl,
      ...(opts.issuer ? { issuer: opts.issuer } : {}),
      ...(opts.fetch ? { fetch: opts.fetch } : {}),
    });
  }

  /** Emit a custom app event (requires the `events:write` scope). */
  async sendEvent(input: SendEventInput): Promise<void> {
    await this.http.request<void>("POST", "/v1/events", {
      apiKey: this.apiKey,
      body: {
        event_type: input.eventType,
        ...(input.userId ? { user_id: input.userId } : {}),
        ...(input.metadata ? { metadata: input.metadata } : {}),
      },
    });
  }

  /** Read events scoped to this key's app (requires `events:read_app`). */
  listEvents(query: ListEventsQuery = {}): Promise<EventRecord[]> {
    return this.http.request<EventRecord[]>("GET", "/v1/events", {
      apiKey: this.apiKey,
      query: {
        event_type: query.eventType,
        user_id: query.userId,
        limit: query.limit,
        offset: query.offset,
      },
    });
  }

  /** Read this app's metadata for one of its users (requires `users:read_app`).
   *  Per-app data your backend stored on the membership — Gateward stays lean,
   *  your app owns the profile. */
  async getUserMetadata(userId: string): Promise<Record<string, unknown>> {
    const res = await this.http.request<{ metadata: Record<string, unknown> }>(
      "GET",
      `/v1/users/${userId}/metadata`,
      { apiKey: this.apiKey },
    );
    return res.metadata;
  }

  /** Shallow-merge `patch` into this app's metadata for a user (requires
   *  `users:write_app`). Existing top-level keys are preserved. Returns the
   *  merged metadata. */
  async updateUserMetadata(
    userId: string,
    patch: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const res = await this.http.request<{ metadata: Record<string, unknown> }>(
      "PATCH",
      `/v1/users/${userId}/metadata`,
      { apiKey: this.apiKey, body: { metadata: patch } },
    );
    return res.metadata;
  }

  /** Members of one of this key's apps (scope `app:user_manage`). The key
   *  can only reach its own app — another app in the ecosystem is a 403. */
  listMembers(appId: string, query: MembersQuery = {}): Promise<MemberPage> {
    return listMembers(this.http, { apiKey: this.apiKey }, appId, query);
  }

  /** One membership. */
  getMember(appId: string, userId: string): Promise<MembershipResponse> {
    return getMember(this.http, { apiKey: this.apiKey }, appId, userId);
  }

  /** Promote or demote a member. The Core refuses (409) to demote the last
   *  `app_admin`; only a platform admin can. */
  setMemberRole(
    appId: string,
    userId: string,
    role: MembershipRole,
  ): Promise<MembershipResponse> {
    return setMemberRole(this.http, { apiKey: this.apiKey }, appId, userId, role);
  }

  // ---- Access: invitations and the waiting list ------------------------
  // Each needs its own scope on the key (`invitations:write`,
  // `waitlist:manage`), and a key only reaches its own app.

  /** Invite one or many addresses (up to 100, atomic). Each result carries
   *  its `token` once; the Core mails it unless `sendEmail` is false. */
  createInvitations(
    appId: string,
    invitations: InvitationInput[],
    opts?: CreateInvitationsOptions,
  ): Promise<CreatedInvitation[]> {
    return createInvitations(this.http, { apiKey: this.apiKey }, appId, invitations, opts);
  }

  listInvitations(
    appId: string,
    query?: { status?: "pending" | "accepted" | "revoked" },
  ): Promise<Invitation[]> {
    return listInvitations(this.http, { apiKey: this.apiKey }, appId, query);
  }

  revokeInvitation(appId: string, id: string): Promise<void> {
    return revokeInvitation(this.http, { apiKey: this.apiKey }, appId, id);
  }

  /** A new code and a fresh expiry; the old code stops working. */
  resendInvitation(appId: string, id: string): Promise<CreatedInvitation> {
    return resendInvitation(this.http, { apiKey: this.apiKey }, appId, id);
  }

  listWaitlist(appId: string, query?: ListWaitlistQuery): Promise<WaitlistEntry[]> {
    return listWaitlist(this.http, { apiKey: this.apiKey }, appId, query);
  }

  waitlistStats(appId: string): Promise<WaitlistStats> {
    return waitlistStats(this.http, { apiKey: this.apiKey }, appId);
  }

  /** Turn waiting-list entries into invitations, by count (arrival order) or
   *  by id. Registering with one marks the entry `joined`. */
  releaseWaitlist(appId: string, input: ReleaseWaitlistInput): Promise<ReleasedEntry[]> {
    return releaseWaitlist(this.http, { apiKey: this.apiKey }, appId, input);
  }

  deleteWaitlistEntry(appId: string, id: string): Promise<void> {
    return deleteWaitlistEntry(this.http, { apiKey: this.apiKey }, appId, id);
  }

  // ---- Notifications and templates (`notifications:send`) --------------

  /** Queue a message. The Core's worker delivers it through the app's
   *  providers, retrying; read the outcome with {@link getNotification}. */
  sendNotification(appId: string, input: SendNotificationInput): Promise<QueuedNotification> {
    return sendNotification(this.http, { apiKey: this.apiKey }, appId, input);
  }

  listNotifications(
    appId: string,
    query?: { status?: "pending" | "sending" | "sent" | "failed" | "skipped" },
  ): Promise<NotificationRecord[]> {
    return listNotifications(this.http, { apiKey: this.apiKey }, appId, query);
  }

  getNotification(appId: string, id: string): Promise<NotificationRecord> {
    return getNotification(this.http, { apiKey: this.apiKey }, appId, id);
  }

  listTemplates(appId: string): Promise<NotificationTemplate[]> {
    return listTemplates(this.http, { apiKey: this.apiKey }, appId);
  }

  /** Store a template. One named after an authentication kind replaces that
   *  email's wording (and must contain `{{token}}`); any other name is one you
   *  send by name. */
  putTemplate(
    appId: string,
    kind: string,
    locale: string,
    template: { subject: string; bodyText: string },
  ): Promise<NotificationTemplate> {
    return putTemplate(this.http, { apiKey: this.apiKey }, appId, kind, locale, template);
  }

  deleteTemplate(appId: string, kind: string, locale: string): Promise<void> {
    return deleteTemplate(this.http, { apiKey: this.apiKey }, appId, kind, locale);
  }

  // ---- Mailing lists (`lists:manage`; broadcasting needs `notifications:send`)

  listMailingLists(appId: string): Promise<MailingList[]> {
    return listMailingLists(this.http, { apiKey: this.apiKey }, appId);
  }

  createMailingList(appId: string, input: CreateMailingListInput): Promise<MailingList> {
    return createMailingList(this.http, { apiKey: this.apiKey }, appId, input);
  }

  updateMailingList(
    appId: string,
    slug: string,
    patch: Parameters<typeof updateMailingList>[4],
  ): Promise<MailingList> {
    return updateMailingList(this.http, { apiKey: this.apiKey }, appId, slug, patch);
  }

  /** Erases the list and all its subscribers. */
  deleteMailingList(appId: string, slug: string): Promise<void> {
    return deleteMailingList(this.http, { apiKey: this.apiKey }, appId, slug);
  }

  listSubscribers(
    appId: string,
    slug: string,
    query?: Parameters<typeof listSubscribers>[4],
  ): Promise<Subscriber[]> {
    return listSubscribers(this.http, { apiKey: this.apiKey }, appId, slug, query);
  }

  deleteSubscriber(appId: string, slug: string, id: string): Promise<void> {
    return deleteSubscriber(this.http, { apiKey: this.apiKey }, appId, slug, id);
  }

  /** One message per active, unsuppressed subscriber, each with their own
   *  unsubscribe link. Returns how many were queued. */
  broadcast(appId: string, slug: string, input: BroadcastInput): Promise<number> {
    return broadcast(this.http, { apiKey: this.apiKey }, appId, slug, input);
  }

  checkSuppression(appId: string, email: string): Promise<SuppressionStatus> {
    return checkSuppression(this.http, { apiKey: this.apiKey }, appId, email);
  }

  /** Block broadcasts to an address, whatever list it is on. */
  addSuppression(
    appId: string,
    email: string,
    reason?: "manual" | "bounce" | "complaint",
  ): Promise<void> {
    return addSuppression(this.http, { apiKey: this.apiKey }, appId, email, reason);
  }

  removeSuppression(appId: string, email: string): Promise<void> {
    return removeSuppression(this.http, { apiKey: this.apiKey }, appId, email);
  }

  // ---- Contact forms (`forms:manage`) -----------------------------------

  listForms(appId: string): Promise<FormDefinition[]> {
    return listForms(this.http, { apiKey: this.apiKey }, appId);
  }

  getFormDefinition(appId: string, slug: string): Promise<FormDefinition> {
    return getFormDefinition(this.http, { apiKey: this.apiKey }, appId, slug);
  }

  /** Create or replace a form's whole definition. */
  putForm(appId: string, slug: string, input: PutFormInput): Promise<FormDefinition> {
    return putForm(this.http, { apiKey: this.apiKey }, appId, slug, input);
  }

  /** Erases the form and all its submissions. */
  deleteForm(appId: string, slug: string): Promise<void> {
    return deleteForm(this.http, { apiKey: this.apiKey }, appId, slug);
  }

  listSubmissions(
    appId: string,
    slug: string,
    query?: { status?: SubmissionStatus; limit?: number; offset?: number },
  ): Promise<FormSubmission[]> {
    return listSubmissions(this.http, { apiKey: this.apiKey }, appId, slug, query);
  }

  getSubmission(appId: string, slug: string, id: string): Promise<FormSubmission> {
    return getSubmission(this.http, { apiKey: this.apiKey }, appId, slug, id);
  }

  updateSubmission(
    appId: string,
    slug: string,
    id: string,
    status: SubmissionStatus,
  ): Promise<FormSubmission> {
    return updateSubmission(this.http, { apiKey: this.apiKey }, appId, slug, id, status);
  }

  deleteSubmission(appId: string, slug: string, id: string): Promise<void> {
    return deleteSubmission(this.http, { apiKey: this.apiKey }, appId, slug, id);
  }

  /** Verify a Gateward access token locally (ES256 via JWKS). Pass
   *  `audience` (the app id) to bind the token to your app. Throws on any
   *  invalid/expired/wrong-audience token. */
  verifyToken(token: string, audience?: string): Promise<GatewardClaims> {
    return this.verifier.verify(token, audience);
  }
}

export type {
  CreateInvitationsOptions,
  InvitationInput,
  ListWaitlistQuery,
  ReleaseWaitlistInput,
} from "./core/access.js";
export type { PutFormInput, SubmissionStatus } from "./core/forms.js";
export type {
  BroadcastInput,
  CreateMailingListInput,
  SendNotificationInput,
} from "./core/messaging.js";
export type {
  CreatedInvitation,
  FormDefinition,
  FormSubmission,
  Invitation,
  MailingList,
  NotificationRecord,
  NotificationTemplate,
  QueuedNotification,
  ReleasedEntry,
  Subscriber,
  SuppressionStatus,
  WaitlistEntry,
  WaitlistStats,
} from "./core/types.js";
