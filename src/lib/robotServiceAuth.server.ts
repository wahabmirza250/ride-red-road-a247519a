/** Server-to-server authentication. Never send this key to browser code. */
export function robotServiceHeaders(): Record<string, string> {
  const key = process.env.ROBOT_SERVICE_KEY;
  return key ? { "X-Robot-Service-Key": key } : {};
}
