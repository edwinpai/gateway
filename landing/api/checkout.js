import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const PRICE_IDS = {
  "inner-circle": "price_1T0RLmDL86iEOXomZhs7l24V",
  "early-adopter": "price_1T0RMCDL86iEOXomoCONKeTK",
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { tier } = req.body;

    if (!tier || !PRICE_IDS[tier]) {
      return res
        .status(400)
        .json({ error: 'Invalid tier. Use "inner-circle" or "early-adopter".' });
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
}
