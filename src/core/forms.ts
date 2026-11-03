import type { HttpClient, RequestOptions } from "./http.js";
import type {
  FormAction,
  FormDefinition,
  FormField,
  FormSubmission,
  PublicForm,
} from "./types.js";

// Contact forms. The Core stores the definition and the submissions; the app
// draws the inputs and the SDK moves the values. Nothing here renders UI.

export function getForm(http: HttpClient, slug: string): Promise<PublicForm> {
  return http.request<PublicForm>("GET", `/v1/forms/${slug}`);
}

export interface SubmitFormOptions {
  /** The value of a hidden input real people leave empty. Anything in it
   *  marks the post as spam (the reply is the same). */
  honeypot?: string;
  /** When the form was shown, epoch ms. A post much faster than the form's
   *  `min_fill_seconds` is held as spam. */
  startedAt?: number;
  /** Sent as the signed-in user, for forms that need a session. */
  bearer?: string;
}

/** Posts the values. A rejected value throws a {@link GatewardError} whose
 *  `fieldErrors` names every failing field at once. */
export async function submitForm(
  http: HttpClient,
  slug: string,
  values: Record<string, string | boolean>,
  opts: SubmitFormOptions = {},
): Promise<void> {
  await http.request<unknown>("POST", `/v1/forms/${slug}/submissions`, {
    ...(opts.bearer ? { bearer: opts.bearer } : {}),
    body: {
      values,
      ...(opts.honeypot ? { honeypot: opts.honeypot } : {}),
      ...(opts.startedAt !== undefined ? { started_at: opts.startedAt } : {}),
    },
  });
}

// ---- Server side (API key) ---------------------------------------------

export interface PutFormInput {
  name: string;
  description?: string;
  fields: FormField[];
  /** `notify_team` and `autoreply`. */
  actions?: FormAction[];
  /** Default `public`. */
  access?: "public" | "authenticated";
  /** 0 to 60, default 3. */
  minFillSeconds?: number;
  /** Days to keep submissions; omit to keep them. */
  retentionDays?: number;
  status?: "active" | "archived";
}

export function listForms(
  http: HttpClient,
  auth: RequestOptions,
  appId: string,
): Promise<FormDefinition[]> {
  return http.request<FormDefinition[]>("GET", `/v1/apps/${appId}/forms`, auth);
}

export function getFormDefinition(
  http: HttpClient,
  auth: RequestOptions,
  appId: string,
  slug: string,
): Promise<FormDefinition> {
  return http.request<FormDefinition>(
    "GET",
    `/v1/apps/${appId}/forms/${slug}`,
    auth,
  );
}

/** Replaces the whole definition (create or update). */
export function putForm(
  http: HttpClient,
  auth: RequestOptions,
  appId: string,
  slug: string,
  input: PutFormInput,
): Promise<FormDefinition> {
  return http.request<FormDefinition>(
    "PUT",
    `/v1/apps/${appId}/forms/${slug}`,
    {
      ...auth,
      body: {
        name: input.name,
        fields: input.fields,
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.actions ? { actions: input.actions } : {}),
        ...(input.access ? { access: input.access } : {}),
        ...(input.minFillSeconds !== undefined
          ? { min_fill_seconds: input.minFillSeconds }
          : {}),
        ...(input.retentionDays !== undefined
          ? { retention_days: input.retentionDays }
          : {}),
        ...(input.status ? { status: input.status } : {}),
      },
    },
  );
}

/** Erases the form and all its submissions. */
export async function deleteForm(
  http: HttpClient,
  auth: RequestOptions,
  appId: string,
  slug: string,
): Promise<void> {
  await http.request<void>("DELETE", `/v1/apps/${appId}/forms/${slug}`, auth);
}

export type SubmissionStatus = "new" | "read" | "replied" | "spam" | "archived";

export function listSubmissions(
  http: HttpClient,
  auth: RequestOptions,
  appId: string,
  slug: string,
  query: { status?: SubmissionStatus; limit?: number; offset?: number } = {},
): Promise<FormSubmission[]> {
  return http.request<FormSubmission[]>(
    "GET",
    `/v1/apps/${appId}/forms/${slug}/submissions`,
    {
      ...auth,
      query: { status: query.status, limit: query.limit, offset: query.offset },
    },
  );
}

export function getSubmission(
  http: HttpClient,
  auth: RequestOptions,
  appId: string,
  slug: string,
  id: string,
): Promise<FormSubmission> {
  return http.request<FormSubmission>(
    "GET",
    `/v1/apps/${appId}/forms/${slug}/submissions/${id}`,
    auth,
  );
}

export function updateSubmission(
  http: HttpClient,
  auth: RequestOptions,
  appId: string,
  slug: string,
  id: string,
  status: SubmissionStatus,
): Promise<FormSubmission> {
  return http.request<FormSubmission>(
    "PATCH",
    `/v1/apps/${appId}/forms/${slug}/submissions/${id}`,
    { ...auth, body: { status } },
  );
}

export async function deleteSubmission(
  http: HttpClient,
  auth: RequestOptions,
  appId: string,
  slug: string,
  id: string,
): Promise<void> {
  await http.request<void>(
    "DELETE",
    `/v1/apps/${appId}/forms/${slug}/submissions/${id}`,
    auth,
  );
}
