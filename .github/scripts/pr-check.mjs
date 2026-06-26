// Runs automatically in GitHub Actions when a PR opens.
const ANTHROPIC = process.env.ANTHROPIC_API_KEY;
const TOKEN = process.env.GITHUB_TOKEN;
const [OWNER, REPO] = (process.env.REPO || "").split("/");
const PR = process.env.PR_NUMBER;

// Seeded brain. (Real version builds this from repo history — already proven in Step 2.)
const brain = [
  { decision: "Platform-specific deployment config files are rejected.",
    examples: ["render.yaml (Render)", "fly.toml (Fly.io)", "railway.json", "Procfile (Heroku)", "vercel.json"],
    evidence: "team policy: no per-host deploy configs" },
  { decision: "New third-party payment provider integrations are not accepted from contributors.",
    examples: ["Paystack", "Razorpay", "Square", "Mollie"],
    evidence: "team policy: payments handled internally" },
];

async function gh(method, path, body) {
  const res = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}${path}`, {
    method,
    headers: { authorization: `Bearer ${TOKEN}`, accept: "application/vnd.github+json", "user-agent": "pr-bot", "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) { console.error(`GitHub ${res.status}: ${(await res.text())}`); process.exit(1); }
  return res.json();
}

async function check(pr) {
  const brainText = brain.map((d) => `- ${d.decision} | covers: ${d.examples.join(", ")} | evidence: ${d.evidence}`).join("\n");
  const prompt = `Team decisions:
${brainText}

NEW pull request:
TITLE: ${pr.title}
DESCRIPTION: ${pr.body || ""}

Does it clearly conflict? Only warn on a clear conflict.
Respond ONLY with JSON: {"warn":true/false,"evidence":"...","explanation":"one sentence","confidence":"high/medium/low"}`;
  for (let i = 1; i <= 2; i++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": ANTHROPIC, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 400, messages: [{ role: "user", content: prompt }] }),
    });
    const data = await res.json();
    if (!data.content) { console.error(`Anthropic empty (try ${i})`); continue; }
    try { return JSON.parse(data.content.map((c) => c.text || "").join("").replace(/```json|```/g, "").trim()); } catch (_) {}
  }
  return null;
}

const pr = await gh("GET", `/pulls/${PR}`);
console.log(`Checking PR #${PR}: ${pr.title}`);
const r = await check(pr);
if (!r) { console.error("AI failed twice; exiting quietly."); process.exit(0); }
console.log(`warn=${r.warn} confidence=${r.confidence}`);

if (r.warn && r.confidence === "high") {
  const comment = `👋 **Heads up before review** — this looks like it may conflict with a past team decision.

**Likely issue:** ${r.explanation}
**Based on:** ${r.evidence}

If this is intentional or things have changed, just say so here. _(Automated pre-check.)_`;
  await gh("POST", `/issues/${PR}/comments`, { body: comment });
  console.log("Posted comment.");
} else {
  console.log("Stayed silent.");
}
