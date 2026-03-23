// ============================================================
// J.A.R.V.I.S — Memory Module
// Summarizes threads into Supabase and injects relevant
// context into synthesis prompts. Always-on, silent.
// ============================================================

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const SUPA_URL           = process.env.SUPABASE_URL;
const SUPA_KEY           = process.env.SUPABASE_SERVICE_KEY;
const OWNER_ID           = process.env.OWNER_ID;
const MEMORY_MODEL       = "anthropic/claude-haiku-4-5";

// ── Summarize a thread and upsert into jarvis_memory_summaries ──
// Called after every saveHistory — non-blocking, fire and forget
async function summarizeThread(ownerScope, threadId) {
  try {
    // Fetch the full thread from jarvis_history
    const res = await fetch(
      `${SUPA_URL}/rest/v1/jarvis_history?owner_id=eq.${encodeURIComponent(ownerScope)}&thread_id=eq.${encodeURIComponent(threadId)}&order=turn_number.asc`,
      { headers: { "apikey": SUPA_KEY, "Authorization": `Bearer ${SUPA_KEY}` } }
    );
    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) return;

    // Build a readable thread transcript
    const transcript = rows.map(r =>
      `User: "${r.question}"\nJARVIS: ${r.synthesis?.slice(0, 400) || ""}...`
    ).join("\n\n");

    // Ask Haiku to summarize
    const summaryRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
      },
      body: JSON.stringify({
        model: MEMORY_MODEL,
        max_tokens: 300,
        temperature: 0.3,
        messages: [{
          role: "user",
          content: `You are summarizing a conversation for long-term memory storage.

Read this conversation and write a compact 3-5 sentence summary capturing:
- The main topic or question discussed
- Key conclusions or positions reached
- Any facts revealed about the user (projects, preferences, beliefs, goals)
- Any decisions or insights worth remembering

Be specific and factual. No filler. Write in third person about the user.

CONVERSATION:
${transcript}

Write only the summary, nothing else.`
        }]
      })
    });

    const summaryData = await summaryRes.json();
    const summary = summaryData.choices?.[0]?.message?.content?.trim();
    if (!summary) return;

    // Upsert summary for this thread (update if exists, insert if not)
    await fetch(`${SUPA_URL}/rest/v1/jarvis_memory_summaries`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": SUPA_KEY,
        "Authorization": `Bearer ${SUPA_KEY}`,
        "Prefer": "resolution=merge-duplicates",
      },
      body: JSON.stringify({
        owner_id: ownerScope,
        thread_id: threadId,
        summary,
        updated_at: new Date().toISOString(),
      }),
    });

    // Also update the rolling user profile
    await updateUserProfile(ownerScope, summary);
  } catch (e) {
    // Memory is non-critical — never throw, never block
    console.error("Memory summarize error:", e?.message);
  }
}

// ── Update the rolling user profile ─────────────────────────
// Merges the new summary into a compressed profile of the user
async function updateUserProfile(ownerScope, newSummary) {
  try {
    // Fetch existing profile
    const res = await fetch(
      `${SUPA_URL}/rest/v1/jarvis_user_profile?owner_id=eq.${encodeURIComponent(ownerScope)}&select=profile`,
      { headers: { "apikey": SUPA_KEY, "Authorization": `Bearer ${SUPA_KEY}` } }
    );
    const rows = await res.json();
    const existingProfile = Array.isArray(rows) && rows[0]?.profile ? rows[0].profile : "";

    // Ask Haiku to merge old profile with new summary
    const mergeRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
      },
      body: JSON.stringify({
        model: MEMORY_MODEL,
        max_tokens: 400,
        temperature: 0.2,
        messages: [{
          role: "user",
          content: `You are maintaining a compressed user profile for a personal AI assistant.

Your job: merge the new information into the existing profile without duplication or bloat.
- Update facts that have changed
- Add new facts not already captured
- Remove outdated or redundant information
- Keep the total profile under 350 words
- Write in concise, factual bullet points
- Focus on: who the user is, what they're building, their preferences, their goals

EXISTING PROFILE:
${existingProfile || "(empty — this is the first entry)"}

NEW INFORMATION TO MERGE:
${newSummary}

Write only the updated profile bullet points, nothing else.`
        }]
      })
    });

    const mergeData = await mergeRes.json();
    const updatedProfile = mergeData.choices?.[0]?.message?.content?.trim();
    if (!updatedProfile) return;

    // Upsert the user profile
    await fetch(`${SUPA_URL}/rest/v1/jarvis_user_profile`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": SUPA_KEY,
        "Authorization": `Bearer ${SUPA_KEY}`,
        "Prefer": "resolution=merge-duplicates",
      },
      body: JSON.stringify({
        owner_id: ownerScope,
        profile: updatedProfile,
        updated_at: new Date().toISOString(),
      }),
    });
  } catch (e) {
    console.error("Memory profile update error:", e?.message);
  }
}

// ── Fetch memory context for injection into synthesis ────────
// Returns a compact string ready to inject into the prompt
async function fetchMemoryContext(ownerScope) {
  try {
    // Get user profile
    const profileRes = await fetch(
      `${SUPA_URL}/rest/v1/jarvis_user_profile?owner_id=eq.${encodeURIComponent(ownerScope)}&select=profile`,
      { headers: { "apikey": SUPA_KEY, "Authorization": `Bearer ${SUPA_KEY}` } }
    );
    const profileRows = await profileRes.json();
    const profile = Array.isArray(profileRows) && profileRows[0]?.profile
      ? profileRows[0].profile
      : null;

    // Get last 5 thread summaries
    const summaryRes = await fetch(
      `${SUPA_URL}/rest/v1/jarvis_memory_summaries?owner_id=eq.${encodeURIComponent(ownerScope)}&order=updated_at.desc&limit=5&select=summary`,
      { headers: { "apikey": SUPA_KEY, "Authorization": `Bearer ${SUPA_KEY}` } }
    );
    const summaryRows = await summaryRes.json();
    const summaries = Array.isArray(summaryRows)
      ? summaryRows.map(r => r.summary).filter(Boolean)
      : [];

    if (!profile && summaries.length === 0) return "";

    const parts = [];
    if (profile) parts.push(`USER PROFILE:\n${profile}`);
    if (summaries.length > 0) parts.push(`RECENT CONVERSATIONS:\n${summaries.map((s,i) => `${i+1}. ${s}`).join("\n")}`);

    return parts.join("\n\n");
  } catch (e) {
    console.error("Memory fetch error:", e?.message);
    return "";
  }
}

module.exports = { summarizeThread, fetchMemoryContext };
