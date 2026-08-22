export const runtime = 'nodejs';

/**
 * Diagnostic sink for the native shell.
 *
 * The app icon picker failed for a week in a way that could not be observed
 * from here: the web layer updates over the air from Vercel, the native shell
 * only changes with a TestFlight build, and the two are invisible to each
 * other. Every diagnosis had to be relayed by hand off a phone screen, which
 * was slow and lossy.
 *
 * This writes what the installed build reports about itself into the runtime
 * logs, where it can be read directly. It stores nothing and returns nothing —
 * it exists so a device that cannot be inspected can describe itself.
 *
 * Sits behind the normal session gate in proxy.ts; it is not a public route.
 */
export async function POST(req: Request) {
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    body = { parseError: true };
  }
  console.log('[diag]', JSON.stringify(body), 'ua=', req.headers.get('user-agent'));
  return new Response(null, { status: 204 });
}
