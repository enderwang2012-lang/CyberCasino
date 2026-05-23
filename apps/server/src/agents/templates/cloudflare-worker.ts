export const CLOUDFLARE_WORKER_TEMPLATE = `// CyberCasino AI Agent - Cloudflare Worker
// 部署: 1) npm i -g wrangler  2) wrangler init  3) 复制此文件到 src/index.ts  4) wrangler secret put LLM_API_KEY  5) wrangler deploy

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }
    const body = await request.json();
    if (body.type === "ping") return Response.json({ status: "ok" });

    const { gameView, validActions, callAmount, minRaise, skill, strategyHint } = body;
    const prompt = buildPrompt(gameView, validActions, callAmount, minRaise, strategyHint);

    const llmRes = await fetch(env.LLM_BASE_URL + "/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + env.LLM_API_KEY },
      body: JSON.stringify({
        model: env.LLM_MODEL || "deepseek-chat",
        messages: [
          { role: "system", content: skill?.systemPrompt || "你是一个德州扑克牌手。" },
          { role: "user", content: prompt },
        ],
        max_tokens: 300,
        temperature: 0.7,
      }),
    });
    const data = await llmRes.json();
    const text = data.choices?.[0]?.message?.content || "";
    const m = text.match(/\\{[\\s\\S]*\\}/);
    if (!m) return Response.json({ action: "fold", thought: "...", isBluffing: false });
    const p = JSON.parse(m[0]);
    return Response.json({
      action: p.action || "fold", amount: p.amount,
      thought: p.thought || "...", isBluffing: p.isBluffing || false, confidence: p.confidence || 0.5,
    });
  },
};

function corsHeaders() {
  return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
}

function buildPrompt(gv, validActions, callAmount, minRaise, hint) {
  const ss = { h:"\\u2665", d:"\\u2666", c:"\\u2663", s:"\\u2660" };
  const rn = { 2:"2",3:"3",4:"4",5:"5",6:"6",7:"7",8:"8",9:"9",10:"10",11:"J",12:"Q",13:"K",14:"A" };
  const cs = c => rn[c.rank] + ss[c.suit];
  const my = gv.myCards.map(cs).join(" ");
  const com = gv.communityCards.length ? gv.communityCards.map(cs).join(" ") : "(无)";
  const ops = gv.players.filter(p=>p.id!==gv.myId&&!p.folded).map(p=>"  "+p.name+": "+p.chips+"筹码, bet "+p.bet+(p.allIn?" [ALL-IN]":"")).join("\\n");
  const hist = (gv.actionHistory||[]).slice(-10).map(a=>"  "+a.playerId+": "+a.action.type+(a.action.amount?" "+a.action.amount:"")).join("\\n");
  let h = ""; if(hint) h="\\n策略建议: "+hint.suggestedAction+" (置信度 "+Math.round(hint.confidence*100)+"%)\\n";
  return "你是德州扑克牌手，请分析局面并决策。\\n\\n手牌: "+my+"\\n公共牌: "+com+"\\n阶段: "+gv.phase+"\\n筹码: "+gv.myChips+"\\n底池: "+gv.pots.reduce((s,p)=>s+p.amount,0)+"\\n跟注: "+callAmount+"\\n最小加注: "+(gv.currentBet+minRaise)+"\\n\\n对手:\\n"+ops+"\\n\\n最近行动:\\n"+(hist||"  (无)")+"\\n\\n合法动作: "+validActions.join(", ")+h+"\\n\\n返回JSON(无markdown): {\"action\":\"fold|check|call|raise\",\"amount\":数字,\"thought\":\"内心独白1-2句\",\"isBluffing\":true/false,\"confidence\":0-1}";
}`;
