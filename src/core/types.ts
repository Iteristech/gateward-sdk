import type { components } from "../generated/api.js";

/** Convenient aliases over the OpenAPI-generated schema objects. */
type Schemas = components["schemas"];

// Client/integrator surface only — admin/management schemas are intentionally
// NOT exported here; the admin dashboard generates its own from the contract.
export type TokenResponse = Schemas["TokenResponse"];
export type RegisterResponse = Schemas["RegisterResponse"];
/** The caller's own identity, from `GET /v1/auth/me`.
 *  `metadata` is arbitrary JSON in the contract (utoipa renders it as the
 *  empty object type), so it is widened to match `getUserMetadata`. */
export type GatewardUser = Omit<Schemas["MeResponse"], "metadata"> & {
  metadata: Record<string, unknown>;
};
export type SessionSummary = Schemas["SessionSummary"];
export type MembershipRole = Schemas["MembershipRole"];
export type PasswordPolicy = Schemas["PasswordPolicy"];
export type AppConfig = Schemas["AppConfigResponse"];
/** `local_metadata` is arbitrary JSON in the contract; widened like
 *  {@link GatewardUser.metadata}. */
export type MembershipResponse = Omit<
  Schemas["MembershipResponse"],
  "local_metadata"
> & { local_metadata: Record<string, unknown> };
export type EventRecord = Schemas["EventRecord"];
export type RegistrationMode = Schemas["RegistrationMode"];
/** ACCESS: invitations, the waiting list, mailing lists and contact forms. */
export type CreatedInvitation = Schemas["CreatedInvitationResponse"];
export type Invitation = Schemas["InvitationResponse"];
export type WaitlistEntry = Schemas["WaitlistEntryResponse"];
export type WaitlistStats = Schemas["WaitlistStatsResponse"];
export type ReleasedEntry = Schemas["ReleasedEntry"];
export type QueuedNotification = Schemas["QueuedNotification"];
export type NotificationRecord = Schemas["NotificationResponse"];
export type NotificationTemplate = Schemas["TemplateResponse"];
export type MailingList = Schemas["ListResponse"];
export type Subscriber = Schemas["SubscriberResponse"];
export type MySubscription = Schemas["MySubscription"];
export type SuppressionStatus = Schemas["SuppressionResponse"];
export type PublicForm = Schemas["PublicFormResponse"];
export type FormField = Schemas["FormField"];
export type FormFieldKind = Schemas["FieldKind"];
export type FormAction = Schemas["FormAction"];
export type FormDefinition = Schemas["FormResponse"];
export type FormSubmission = Schemas["SubmissionResponse"];
export type ActorKind = Schemas["ActorKind"];
export type Jwk = Schemas["Jwk"];
export type JwksResponse = Schemas["JwksResponse"];
export type ForgotPasswordResponse = Schemas["ForgotPasswordResponse"];
export type ResendVerificationEmailResponse =
  Schemas["ResendVerificationEmailResponse"];

/** A cross-platform `fetch` implementation (defaults to global `fetch`). */
export type FetchLike = typeof fetch;

/** Claims carried in a Gateward access token (ES256 JWT). Not part of the
 *  OpenAPI contract — mirrors the Core's `jwt::Claims`. */
export interface GatewardClaims {
  /** User (or service account) id. */
  sub: string;
  ecosystem_id: string;
  identity_pool_id: string;
  /** Absent for platform-admin tokens. */
  app_id?: string;
  session_id: string;
  actor_kind: ActorKind;
  scopes: string[];
  iss: string;
  aud: string;
  iat: number;
  exp: number;
}
