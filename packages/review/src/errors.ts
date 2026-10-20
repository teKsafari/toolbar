// Human lines for failed requests, shared by the reviewer toolbar and the extension's popup.

/** Human line for a failed request. */
export function errorText(r: { ok: false; error: string; message?: string }): string {
  if (r.message && r.error !== 'not_implemented') return r.message;
  switch (r.error) {
    case 'not_signed_in':
      return 'Sign in to continue';
    case 'restricted_page':
      return 'Open a normal web page first';
    case 'busy':
      return 'Finish the open capture first';
    case 'not_implemented':
      return 'Not available in this build yet';
    case 'network':
      return 'The server did not answer';
    case 'permission_denied':
      return 'Permission missing';
    default:
      return r.message ?? 'Something went wrong';
  }
}
