import type {
  AgentGameView,
  AgentDecision,
  AgentThought,
  Action,
  ActionType,
  AgentPersonality,
  Card,
} from "@cybercasino/shared";
import { evaluateHand } from "@cybercasino/engine";

interface RuleResult {
  decision: AgentDecision | null;
  confidence: number;
}

const PREMIUM_HANDS = [
  [14, 14], [13, 13], [12, 12], [11, 11], [10, 10],
  [14, 13], [14, 12], [14, 11],
];

const GOOD_HANDS = [
  [9, 9], [8, 8], [7, 7],
  [14, 10], [13, 12], [13, 11], [12, 11],
];

function isPremium(cards: Card[]): boolean {
  const ranks = cards.map((c) => c.rank).sort((a, b) => b - a);
  return PREMIUM_HANDS.some((h) => h[0] === ranks[0] && h[1] === ranks[1]);
}

function isGood(cards: Card[]): boolean {
  const ranks = cards.map((c) => c.rank).sort((a, b) => b - a);
  const suited = cards[0].suit === cards[1].suit;
  if (GOOD_HANDS.some((h) => h[0] === ranks[0] && h[1] === ranks[1])) return true;
  if (suited && ranks[0] - ranks[1] <= 2 && ranks[1] >= 8) return true;
  return false;
}

function isTrash(cards: Card[]): boolean {
  return !isPremium(cards) && !isGood(cards) && cards[0].rank < 10 && cards[1].rank < 10;
}

function handStrengthPostflop(myCards: Card[], communityCards: Card[]): number {
  if (communityCards.length === 0) return 0.5;
  const allCards = [...myCards, ...communityCards];
  const evaluated = evaluateHand(allCards);
  const rankScores: Record<string, number> = {
    "high-card": 0.15,
    "pair": 0.35,
    "two-pair": 0.6,
    "three-of-a-kind": 0.82,
    "straight": 0.85,
    "flush": 0.88,
    "full-house": 0.93,
    "four-of-a-kind": 0.97,
    "straight-flush": 0.99,
    "royal-flush": 1.0,
  };
  return rankScores[evaluated.rank] ?? 0.5;
}

function pick(arr: string[]): string {
  return arr[Math.floor(Math.random() * arr.length)];
}

const PERSONA_LINES: Record<string, {
  premium: string[];
  good: string[];
  trash: string[];
  bluff: string[];
  monster: string[];
  weak: string[];
  freeCard: string[];
  fold: string[];
  strongCall: string[];
}> = {
  neon: {
    premium: ["终于等到了好牌", "耐心等待终有回报", "这手牌值得一战"],
    good: ["还行，看看翻牌再说", "不着急，慢慢来", "值得投入看看"],
    trash: ["不是我的牌，pass", "耐心是美德", "等下一手吧"],
    bluff: ["偶尔也要出其不意", "...让我试试", "这次冒一下险"],
    monster: ["稳住，别让他们看出来", "慢慢来，不要吓跑鱼", "完美的牌面"],
    weak: ["不值得冒险", "明智的选择是退出", "筹码比面子重要"],
    freeCard: ["免费看牌，何乐不为", "不花钱能看就看", "没有下注就看看"],
    fold: ["纪律第一", "不符合我的标准", "弃牌不丢人"],
    strongCall: ["有把握，跟上", "数学站在我这边", "值得跟进"],
  },
  viper: {
    premium: ["该出手时就出手！加注！", "哈哈，让我来搅局", "是时候给你们点压力了"],
    good: ["还不错，先跟着玩", "让我看看你们的底线", "有点意思"],
    trash: ["切，这破牌...", "算了算了", "今天不是我的日子"],
    bluff: ["来吧来吧！谁怕谁！", "虚虚实实才好玩", "压力给到对面"],
    monster: ["ALL IN！不是，冷静...先加注", "猎物上钩了", "收网时刻！"],
    weak: ["烂牌也能打，但算了", "这次放你们一马", "不值得浪费弹药"],
    freeCard: ["免费看？那肯定看", "白嫖一张牌", "不花钱就看看"],
    fold: ["哼，下次再收拾你们", "战略性撤退", "这把不玩了"],
    strongCall: ["跟！怕什么！", "来嘛来嘛", "你加我就跟"],
  },
  ghost: {
    premium: ["...装作若无其事的样子", "表面平静，内心狂喜", "面具之下是微笑"],
    good: ["让他们猜不透...", "虚实之间", "保持神秘感"],
    trash: ["这手牌...不过也许可以演一出戏", "真正的高手不看牌", "牌面不重要，重要的是表演"],
    bluff: ["看我的演技", "谁是猎人，谁是猎物？", "一切都是假象"],
    monster: ["...故意露出破绽", "让他们以为我在诈唬", "反向心理战"],
    weak: ["识时务者为俊杰", "虚张声势也要看时机", "这次就不演了"],
    freeCard: ["观察对手的表情...", "信息比筹码更珍贵", "先看看再说"],
    fold: ["消失在黑暗中...", "幽灵从不恋战", "下次出手，必定致命"],
    strongCall: ["不动声色地跟注", "他们猜不到我有什么", "冷静跟进"],
  },
  oracle: {
    premium: ["期望值为正，加注是最优解", "EV+，执行标准策略", "数学告诉我应该加注"],
    good: ["赔率合适，值得投入", "隐含赔率不错", "概率在我这边"],
    trash: ["EV为负，弃牌", "不符合GTO范围", "数学不支持继续"],
    bluff: ["平衡弃牌范围需要偶尔诈唬", "为了保持range balance...", "GTO要求这里有诈唬频率"],
    monster: ["控制底池大小，最大化期望值", "价值下注，分三条街打满", "完美的价值榨取机会"],
    weak: ["期望值为负，果断弃牌", "沉没成本不影响决策", "止损是最优选择"],
    freeCard: ["零成本看一张公共牌", "信息价值大于零", "过牌等待更多信息"],
    fold: ["概率不支持继续", "清晰的弃牌决策", "EV-，不犹豫"],
    strongCall: ["底池赔率合适，跟注", "正期望值跟注", "数学上必须跟进"],
  },
  shark: {
    premium: ["闻到血腥味了...", "猎物出现了", "准备收割"],
    good: ["还不错，看看谁是鱼", "找找弱点在哪", "测试一下对手"],
    trash: ["没有弱点可利用", "这桌暂时没有猎物", "不值得出手"],
    bluff: ["欺负弱手最开心了", "看谁先扛不住", "给他们施加压力"],
    monster: ["嘿嘿嘿...上钩了", "鲨鱼觅食时间", "完美的伏击时机"],
    weak: ["这次没有机会", "不是每次都能吃到鱼", "留着弹药找软柿子"],
    freeCard: ["观察猎物的弱点...", "收集情报", "看看谁在发抖"],
    fold: ["不浪费子弹", "猎手也需要等待", "下一个目标"],
    strongCall: ["跟着猎物的节奏", "紧咬不放", "不让猎物逃跑"],
  },
  fox: {
    premium: ["嘿嘿，这次来真的~", "狐狸笑了", "有趣有趣~"],
    good: ["也许玩一玩？", "随心情来吧", "今天往左还是往右呢~"],
    trash: ["无聊...弃了吧", "没意思没意思", "下一把来点刺激的"],
    bluff: ["哈哈哈哈没有人能读懂我", "猜猜我是真是假？", "风格切换！"],
    monster: ["装作很犹豫的样子...", "叹口气...好吧...只能跟注了（假的）", "故意看了好几次牌"],
    weak: ["溜了溜了~", "这把不好玩", "换个策略再来"],
    freeCard: ["免费的最香了~", "白看一眼", "不花钱？太好了~"],
    fold: ["无聊~弃了", "哼~不玩了", "等我想出新花样再来"],
    strongCall: ["跟~跟~跟~", "好玩好玩", "继续继续~"],
  },
};

function makeThought(
  message: string,
  confidence: number,
  isBluffing: boolean
): AgentThought {
  return { message, confidence, isBluffing };
}

function personalizedThought(
  personalityId: string,
  category: keyof typeof PERSONA_LINES["neon"],
  confidence: number,
  isBluffing: boolean
): AgentThought {
  const lines = PERSONA_LINES[personalityId];
  const message = lines ? pick(lines[category]) : "...";
  return { message, confidence, isBluffing };
}

export function ruleDecide(
  view: AgentGameView,
  personality: AgentPersonality,
  validActions: ActionType[],
  callAmount: number,
  minRaise: number
): RuleResult {
  const { myCards, phase, communityCards, pots, smallBlind, bigBlind } = view;
  const potSize = pots.reduce((s, p) => s + p.amount, 0);
  const { tightness, aggression, bluffFrequency, id: pid } = personality;
  const rand = Math.random();

  if (phase === "preflop") {
    if (isPremium(myCards)) {
      if (validActions.includes("raise")) {
        const amount = Math.max(view.currentBet + minRaise, bigBlind * 3);
        return {
          confidence: 0.9,
          decision: {
            action: { type: "raise", amount },
            thought: personalizedThought(pid, "premium", 0.85, false),
          },
        };
      }
      return {
        confidence: 0.9,
        decision: {
          action: { type: "call" },
          thought: personalizedThought(pid, "premium", 0.8, false),
        },
      };
    }

    if (isTrash(myCards) && rand > (1 - tightness)) {
      if (rand < bluffFrequency * 0.3 && validActions.includes("raise")) {
        const amount = view.currentBet + minRaise;
        return {
          confidence: 0.7,
          decision: {
            action: { type: "raise", amount },
            thought: personalizedThought(pid, "bluff", 0.3, true),
          },
        };
      }
      return {
        confidence: 0.8,
        decision: {
          action: { type: "fold" },
          thought: personalizedThought(pid, "fold", 0.1, false),
        },
      };
    }

    if (isGood(myCards)) {
      if (callAmount <= bigBlind * 2) {
        return {
          confidence: 0.7,
          decision: {
            action: validActions.includes("call") ? { type: "call" } : { type: "check" },
            thought: personalizedThought(pid, "good", 0.55, false),
          },
        };
      }
    }

    return { decision: null, confidence: 0.3 };
  }

  const strength = handStrengthPostflop(myCards, communityCards);

  if (strength >= 0.8) {
    if (validActions.includes("raise")) {
      const amount = Math.max(view.currentBet + minRaise, Math.floor(potSize * 0.7));
      return {
        confidence: 0.95,
        decision: {
          action: { type: "raise", amount },
          thought: personalizedThought(pid, "monster", 0.95, false),
        },
      };
    }
    return {
      confidence: 0.9,
      decision: {
        action: validActions.includes("call") ? { type: "call" } : { type: "check" },
        thought: personalizedThought(pid, "strongCall", 0.9, false),
      },
    };
  }

  if (strength < 0.25) {
    if (callAmount > 0 && rand > bluffFrequency) {
      return {
        confidence: 0.75,
        decision: {
          action: { type: "fold" },
          thought: personalizedThought(pid, "weak", 0.15, false),
        },
      };
    }
    if (rand < bluffFrequency && validActions.includes("raise")) {
      const amount = Math.max(view.currentBet + minRaise, Math.floor(potSize * 0.5));
      return {
        confidence: 0.6,
        decision: {
          action: { type: "raise", amount },
          thought: personalizedThought(pid, "bluff", 0.2, true),
        },
      };
    }
    if (callAmount === 0 && validActions.includes("check")) {
      return {
        confidence: 0.7,
        decision: {
          action: { type: "check" },
          thought: personalizedThought(pid, "freeCard", 0.2, false),
        },
      };
    }
  }

  return { decision: null, confidence: strength };
}

export function ruleFallback(
  view: AgentGameView,
  personality: AgentPersonality,
  validActions: ActionType[],
  callAmount: number,
): AgentDecision {
  const pid = personality.id;
  const { aggression } = personality;

  if (callAmount === 0 && validActions.includes("check")) {
    return {
      action: { type: "check" },
      thought: personalizedThought(pid, "freeCard", 0.3, false),
    };
  }

  if (callAmount <= view.bigBlind * 2 && Math.random() < aggression) {
    return {
      action: validActions.includes("call") ? { type: "call" } : { type: "check" },
      thought: personalizedThought(pid, "good", 0.4, false),
    };
  }

  return {
    action: { type: "fold" },
    thought: personalizedThought(pid, "fold", 0.15, false),
  };
}
