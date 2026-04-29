import type { Pot } from "@cybercasino/shared";

interface PlayerBet {
  playerId: string;
  amount: number;
  folded: boolean;
}

export class PotManager {
  private bets: PlayerBet[] = [];

  reset(playerIds: string[]): void {
    this.bets = playerIds.map((id) => ({ playerId: id, amount: 0, folded: false }));
  }

  addBet(playerId: string, amount: number): void {
    const player = this.bets.find((b) => b.playerId === playerId);
    if (player) {
      player.amount += amount;
    }
  }

  markFolded(playerId: string): void {
    const player = this.bets.find((b) => b.playerId === playerId);
    if (player) {
      player.folded = true;
    }
  }

  calculatePots(): Pot[] {
    const pots: Pot[] = [];
    const sorted = [...this.bets].sort((a, b) => a.amount - b.amount);
    let processed = 0;

    for (let i = 0; i < sorted.length; i++) {
      const level = sorted[i].amount;
      if (level <= processed) continue;

      const contribution = level - processed;
      let potAmount = 0;
      const eligible: string[] = [];

      for (const bet of sorted) {
        if (bet.amount > processed) {
          const contrib = Math.min(bet.amount - processed, contribution);
          potAmount += contrib;
        }
        if (bet.amount >= level && !bet.folded) {
          eligible.push(bet.playerId);
        }
      }

      if (potAmount > 0) {
        pots.push({ amount: potAmount, eligiblePlayerIds: eligible });
      }
      processed = level;
    }

    return pots;
  }

  getTotalPot(): number {
    return this.bets.reduce((sum, b) => sum + b.amount, 0);
  }

  getPlayerBet(playerId: string): number {
    return this.bets.find((b) => b.playerId === playerId)?.amount ?? 0;
  }
}
