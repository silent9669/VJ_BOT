export const LOCAL_ADMIN_ID = 'email:local-admin';

// Both checks are required: this secret is only in ignored .dev.vars, never a deployed binding.
export function localAdminEnabled(request, env) {
  return Boolean(env.LOCAL_TEST_ADMIN_PASSWORD) && ['localhost','127.0.0.1','[::1]'].includes(new URL(request.url).hostname);
}
