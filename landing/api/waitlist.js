// Vercel KV or simple in-memory for now — upgrade to a DB later
// For now, log to Vercel's function logs and return success
// TODO: Connect to a proper email list (Listmonk, Mailchimp, etc.)

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { email } = req.body;

    if (!email || !email.includes("@")) {
      return res.status(400).json({ error: "Invalid email" });
    }

    // Log the signup (visible in Vercel function logs)
    console.log(`[waitlist] New signup: ${email} at ${new Date().toISOString()}`);

    // TODO: Store in Vercel KV, Supabase, or send to Listmonk
    // For now, just acknowledge
    res.json({ ok: true });
  } catch (error) {
    console.error("Waitlist error:", error);
    res.status(500).json({ error: error.message });
  }
}
