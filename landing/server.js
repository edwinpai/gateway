import express from "express";
import { promises as fs, readFileSync } from "fs";
import path from "path";
import Stripe from "stripe";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load Stripe key from ~/.edwinpai/.env
const envPath = path.join(process.env.HOME, ".edwinpai", ".env");
const envContent = readFileSync(envPath, "utf8");
const stripeKeyMatch = envContent.match(/STRIPE_SECRET_KEY=(.+)/);
if (!stripeKeyMatch) {
  console.error("STRIPE_SECRET_KEY not found in ~/.edwinpai/.env");
  process.exit(1);
}
const stripe = Stripe(stripeKeyMatch[1].trim());

const app = express();
const PORT = 3005;

app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Price IDs from Stripe
const PRICE_IDS = {
  "inner-circle": "price_1T0RLmDL86iEOXomZhs7l24V",
  "early-adopter": "price_1T0RMCDL86iEOXomoCONKeTK",
};

// POST /api/checkout
app.post("/api/checkout", async (req, res) => {
  try {
    const { tier } = req.body;

    if (!tier || !PRICE_IDS[tier]) {
      return res.status(400).json({ error: "Invalid tier" });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price: PRICE_IDS[tier],
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: "https://edwinpai.com?success=true",
      cancel_url: "https://edwinpai.com?canceled=true",
    });

    res.json({ url: session.url });
  } catch (error) {
    console.error("Checkout error:", error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/waitlist
app.post("/api/waitlist", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email || !email.includes("@")) {
      return res.status(400).json({ error: "Invalid email" });
    }

    const waitlistPath = path.join(__dirname, "waitlist.json");
    let waitlist = [];

    try {
      const data = await fs.readFile(waitlistPath, "utf8");
      waitlist = JSON.parse(data);
    } catch {
      // File doesn't exist yet, start fresh
    }

    // Add new email with timestamp
    waitlist.push({
      email,
      timestamp: new Date().toISOString(),
    });

    await fs.writeFile(waitlistPath, JSON.stringify(waitlist, null, 2));

    res.json({ ok: true });
  } catch (error) {
    console.error("Waitlist error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`EdwinPAI landing API listening on port ${PORT}`);
});
