/**
 * Keeping tenant secrets out of the browser.
 *
 * Each hospital supplies its own Retell / ElevenLabs keys and S3 credentials,
 * which are stored per tenant so one deployment can serve many hospitals. They
 * must never travel to a client: a key in a browser is a key in every browser
 * extension, every screen recording and every support screenshot, and it bills
 * calls and reads the recordings bucket for the hospital that owns it.
 *
 * This lived inside the settings route, which redacted correctly — while
 * `/api/bootstrap` published the same blobs unredacted to every signed-in user.
 * One copy, imported by both, is the point.
 */
export function redactSecrets(key: string, value: unknown) {
  if (key !== "voice" && key !== "storage") return value;
  const v = JSON.parse(JSON.stringify(value)) as Record<string, Record<string, unknown>>;
  if (key === "voice") {
    if (v.retell) v.retell.apiKey = v.retell.apiKey ? "••••••••" : "";
    if (v.retell) v.retell.webhookSecret = v.retell.webhookSecret ? "••••••••" : "";
    if (v.elevenlabs) v.elevenlabs.apiKey = v.elevenlabs.apiKey ? "••••••••" : "";
  }
  if (key === "storage" && v.s3) v.s3.secretAccessKey = v.s3.secretAccessKey ? "••••••••" : "";
  return v;
}

