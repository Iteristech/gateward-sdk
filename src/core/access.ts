import type { HttpClient, RequestOptions } from "./http.js";
import type {
  CreatedInvitation,
  Invitation,
  MembershipRole,
  ReleasedEntry,
  WaitlistEntry,
  WaitlistStats,
} from "./types.js";

// Registration by invitation and the waiting list. Headless: these move data
// and report state; the app draws the screens.

export interface JoinWaitlistOptions {
  /** Free-form object kept with the entry (referrer, interest). Up to 4 KB. */
  metadata?: Record<string, unknown>;
  /** Language for later emails, e.g. `es-MX`. */
  locale?: string;
  /** Where the address was collected; kept as the consent record. */
  consentSource?: string;
}

/** Always resolves the same way whether or not the address was already
 *  listed, so it cannot be used to probe who signed up. The person must still
 *  confirm from their inbox. */
export async function joinWaitlist(
  http: HttpClient,
  email: string,
  opts: JoinWaitlistOptions = {},
): Promise<void> {
  await http.request<unknown>("POST", "/v1/waitlist", {
    body: {
      email,
      ...(opts.metadata ? { metadata: opts.metadata } : {}),
      ...(opts.locale ? { locale: opts.locale } : {}),
      ...(opts.consentSource ? { consent_source: opts.consentSource } : {}),
    },
  });
}

export async function confirmWaitlist(
  http: HttpClient,
  token: string,
): Promise<void> {
  await http.request<unknown>("POST", "/v1/waitlist/confirm", {
    body: { token },
  });
}

// ---- Server side (API key) ---------------------------------------------

export interface InvitationInput {
  email: string;
  /** Defaults to `member`. */
  role?: MembershipRole;
}

export interface CreateInvitationsOptions {
  /** 1 to 30, default 7. */
  expiresInDays?: number;
  /** Default true. Pass false to deliver the codes yourself. */
  sendEmail?: boolean;
}

/** One or many (up to 100, atomic). Each result carries its `token` once. */
export function createInvitations(
  http: HttpClient,
  auth: RequestOptions,
  appId: string,
  invitations: InvitationInput[],
  opts: CreateInvitationsOptions = {},
): Promise<CreatedInvitation[]> {
  return http.request<CreatedInvitation[]>(
    "POST",
    `/v1/apps/${appId}/invitations`,
    {
      ...auth,
      body: {
        invitations,
        ...(opts.expiresInDays !== undefined
          ? { expires_in_days: opts.expiresInDays }
          : {}),
        ...(opts.sendEmail !== undefined ? { send_email: opts.sendEmail } : {}),
      },
    },
  );
}

export function listInvitations(
  http: HttpClient,
  auth: RequestOptions,
  appId: string,
  query: { status?: "pending" | "accepted" | "revoked" } = {},
): Promise<Invitation[]> {
  return http.request<Invitation[]>("GET", `/v1/apps/${appId}/invitations`, {
    ...auth,
    query: { status: query.status },
  });
}

export async function revokeInvitation(
  http: HttpClient,
  auth: RequestOptions,
  appId: string,
  id: string,
): Promise<void> {
  await http.request<void>("DELETE", `/v1/apps/${appId}/invitations/${id}`, auth);
}

/** A new code and a fresh expiry; the old code stops working. */
export function resendInvitation(
  http: HttpClient,
  auth: RequestOptions,
  appId: string,
  id: string,
): Promise<CreatedInvitation> {
  return http.request<CreatedInvitation>(
    "POST",
    `/v1/apps/${appId}/invitations/${id}/resend`,
    auth,
  );
}

export type WaitlistStatus = "pending" | "confirmed" | "invited" | "joined";

export interface ListWaitlistQuery {
  status?: WaitlistStatus;
  limit?: number;
  offset?: number;
  /** Only entries changed at or after this instant, oldest change first.
   *  Inclusive: dedupe by `id` and `updated_at`. Deletions never show up
   *  here; the `waitlist_entry_deleted` event reports them. */
  updatedSince?: Date | string;
}

export function listWaitlist(
  http: HttpClient,
  auth: RequestOptions,
  appId: string,
  query: ListWaitlistQuery = {},
): Promise<WaitlistEntry[]> {
  return http.request<WaitlistEntry[]>("GET", `/v1/apps/${appId}/waitlist`, {
    ...auth,
    query: {
      status: query.status,
      limit: query.limit,
      offset: query.offset,
      updated_since:
        query.updatedSince instanceof Date ? query.updatedSince.toISOString() : query.updatedSince,
    },
  });
}

/** One entry, as named by the `entry_id` of the waitlist events. */
export function getWaitlistEntry(
  http: HttpClient,
  auth: RequestOptions,
  appId: string,
  id: string,
): Promise<WaitlistEntry> {
  return http.request<WaitlistEntry>("GET", `/v1/apps/${appId}/waitlist/${id}`, auth);
}

/** Confirms an entry on behalf of a mail service that ran its own opt-in
 *  (apps with `waitlist_confirm_email` off). Repeating it is harmless; an
 *  entry already invited or joined answers 409. */
export function confirmWaitlistEntry(
  http: HttpClient,
  auth: RequestOptions,
  appId: string,
  id: string,
): Promise<WaitlistEntry> {
  return http.request<WaitlistEntry>("POST", `/v1/apps/${appId}/waitlist/${id}/confirm`, auth);
}

/** The whole list as CSV text, in arrival order (up to 100000 rows, without
 *  the free-form metadata). */
export function exportWaitlist(
  http: HttpClient,
  auth: RequestOptions,
  appId: string,
  status?: WaitlistStatus,
): Promise<string> {
  return http.request<string>("GET", `/v1/apps/${appId}/waitlist/export`, {
    ...auth,
    query: { status },
  });
}

export function waitlistStats(
  http: HttpClient,
  auth: RequestOptions,
  appId: string,
): Promise<WaitlistStats> {
  return http.request<WaitlistStats>(
    "GET",
    `/v1/apps/${appId}/waitlist/stats`,
    auth,
  );
}

export interface ReleaseWaitlistInput {
  /** The first N in arrival order (up to 500). Use this or `ids`. */
  count?: number;
  /** These entries. Use this or `count`. */
  ids?: string[];
  /** Also release entries that never confirmed their address. */
  includeUnconfirmed?: boolean;
  role?: MembershipRole;
  expiresInDays?: number;
  /** Default true. With false the codes come back in the result. */
  sendEmail?: boolean;
}

/** Turns waiting-list entries into invitations. Registering with one marks
 *  the entry `joined`. */
export async function releaseWaitlist(
  http: HttpClient,
  auth: RequestOptions,
  appId: string,
  input: ReleaseWaitlistInput,
): Promise<ReleasedEntry[]> {
  const res = await http.request<{ released: ReleasedEntry[] }>(
    "POST",
    `/v1/apps/${appId}/waitlist/release`,
    {
      ...auth,
      body: {
        ...(input.count !== undefined ? { count: input.count } : {}),
        ...(input.ids ? { ids: input.ids } : {}),
        ...(input.includeUnconfirmed
          ? { include_unconfirmed: true }
          : {}),
        ...(input.role ? { role: input.role } : {}),
        ...(input.expiresInDays !== undefined
          ? { expires_in_days: input.expiresInDays }
          : {}),
        ...(input.sendEmail !== undefined ? { send_email: input.sendEmail } : {}),
      },
    },
  );
  return res.released;
}

/** Erases the entry and revokes any invitation still pending for it. */
export async function deleteWaitlistEntry(
  http: HttpClient,
  auth: RequestOptions,
  appId: string,
  id: string,
): Promise<void> {
  await http.request<void>("DELETE", `/v1/apps/${appId}/waitlist/${id}`, auth);
}
