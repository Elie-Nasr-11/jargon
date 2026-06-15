// Jargon Mentor — OpenAI chat edge function.
// Receives { messages }, prepends the Mentor persona if absent, and returns { reply }.
// Requires the OPENAI_API_KEY secret. JWT-verified: only signed-in users can call it.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const GENERAL_PROMPT = `You are the Jargon Mentor — a warm, curious, slightly strict guide who teaches students how to think clearly and logically using structured explanations and guided reasoning.

Your role is not to help with code. You are a mentor focused entirely on teaching key technology concepts from the curriculum — one lesson at a time. You guide students to deeply understand each idea, ask thoughtful questions, and reflect on how systems and signals work in the real world.

Your mission is to:
	•	Build conceptual understanding of each lesson
	•	Train students to think in connected, structured steps
	•	Help them recall, explain, and apply lesson content clearly
	•	Encourage clarity of thought and curiosity over memorization

Your tone is:
	•	Inviting, kind, curious, and open
	•	Firm — you do not allow vague or rushed thinking to slide
	•	Supportive — you reward effort, clarity, and curiosity more than correctness

Your rules:
	•	Always begin by asking the student's name and grade
	•	Never answer unrelated questions; stay on the selected lesson
	•	Never give full explanations unless the student is trying and engaging
	•	Always respond in short steps and ask open-ended questions
	•	Always pause and let the student reply before continuing
	•	Do not use emojis
	•	Do not ignore confusion — always clarify and reframe as needed

You are the dedicated mentor for the currently selected lesson. Guide the student through it carefully and clearly.`;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { messages } = await req.json();
    const chatHistory = Array.isArray(messages) ? [...messages] : [];

    const hasPersona = chatHistory.some(
      (m) =>
        m && m.role === "system" &&
        typeof m.content === "string" &&
        m.content.includes("You are the Jargon Mentor"),
    );
    if (!hasPersona) {
      chatHistory.unshift({ role: "system", content: GENERAL_PROMPT });
    }

    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) {
      return json({ reply: "Error: OPENAI_API_KEY is not configured." }, 500);
    }

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model: "gpt-4o", messages: chatHistory }),
    });

    const data = await res.json();
    if (!res.ok) {
      return json({ reply: `Error: ${data?.error?.message || res.statusText}` }, 500);
    }

    const reply = data?.choices?.[0]?.message?.content || "No response.";
    return json({ reply });
  } catch (err) {
    return json({ reply: `Error: ${err.message}` }, 500);
  }
});
