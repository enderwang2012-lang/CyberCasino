export default {
  async fetch(request: Request): Promise<Response> {
    const body = await request.json() as any;

    // ── Heartbeat ──
    if (body.type === "ping") {
      return Response.json({ status: "ok" });
    }

    // ── Decision ──
    if (body.type === "decision") {
      const { gameView, validActions, callAmount, stylePrompt } = body;
      const { myCards, communityCards, phase, myChips, myBet, currentBet, pots, players } = gameView;

      // Build a prompt describing the situation
      const cardNames = (cards: Array<{rank:number;suit:string}>) =>
        cards?.map((c) => {
          const r = c.rank <= 10 ? String(c.rank) : ["J","Q","K","A"][c.rank - 11];
          const s = {h:"♥",d:"♦",c:"♣",s:"♠"}[c.suit];
          return r + s;
        }).join(" ") ?? "none";

      const phaseName = {preflop:"Pre-flop",flop:"Flop",turn:"Turn",river:"River"}[phase] ?? phase;
      const potTotal = pots?.reduce((sum:number, p:any) => sum + p.amount, 0) ?? 0;

      const prompt = [
        `You are a Texas Hold'em poker player with this style: ${stylePrompt}`,
        '',
        `Phase: ${phaseName}`,
        `Your hand: ${cardNames(myCards)}`,
        `Community cards: ${cardNames(communityCards)}`,
        `Your chips: ${myChips}, Your current bet: ${myBet}`,
        `Current bet to match: ${currentBet}, Pot: ${potTotal}`,
        `Call amount: ${callAmount}`,
        `Valid actions: ${validActions.join(", ")}`,
        '',
        'Respond with JSON: {"action":"<action>","thought":"<your reasoning in character, 1 sentence>"}',
        'If action is "raise", include "amount" field (minimum raise amount is in the request).',
      ].join("\n");

      // ── Replace this with your LLM call ──
      // Example with OpenAI:
      // const ai = await fetch("https://api.openai.com/v1/chat/completions", {
      //   method: "POST",
      //   headers: {
      //     "Content-Type": "application/json",
      //     "Authorization": "Bearer " + OPENAI_API_KEY,
      //   },
      //   body: JSON.stringify({
      //     model: "gpt-4o-mini",
      //     messages: [
      //       { role: "system", content: "You are a poker-playing AI. Respond in character." },
      //       { role: "user", content: prompt },
      //     ],
      //     temperature: 0.7,
      //   }),
      // });
      // const data = await ai.json() as any;
      // const result = JSON.parse(data.choices[0].message.content);
      // return Response.json(result);

      // Example with Anthropic:
      // const ai = await fetch("https://api.anthropic.com/v1/messages", {
      //   method: "POST",
      //   headers: {
      //     "Content-Type": "application/json",
      //     "x-api-key": ANTHROPIC_API_KEY,
      //     "anthropic-version": "2023-06-01",
      //   },
      //   body: JSON.stringify({
      //     model: "claude-sonnet-4-6",
      //     max_tokens: 200,
      //     messages: [{ role: "user", content: prompt }],
      //   }),
      // });
      // const data = await ai.json() as any;
      // const result = JSON.parse(data.content[0].text);
      // return Response.json(result);

      // ── Default fallback (replace with LLM call above) ──
      const action = validActions.includes("call") ? "call" : validActions[0];
      return Response.json({
        action,
        thought: `[Using fallback - wire up your LLM in the template above]`,
      });
    }

    return Response.json({ error: "Unknown type" }, { status: 400 });
  },
};