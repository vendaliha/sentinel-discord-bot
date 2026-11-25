const { randomInt } = require("node:crypto");

function migrateGiveawayWinnerHistory(db) {
  const columns = new Set(db.prepare("PRAGMA table_info(giveaways)").all().map(column => column.name));
  if (!columns.has("allow_bots")) {
    db.exec("ALTER TABLE giveaways ADD COLUMN allow_bots INTEGER NOT NULL DEFAULT 0 CHECK (allow_bots IN (0, 1))");
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS giveaway_winner_history (
      giveaway_id INTEGER NOT NULL,
      user_id TEXT NOT NULL,
      won_at INTEGER NOT NULL,
      PRIMARY KEY (giveaway_id, user_id)
    )
  `);

  db.transaction(() => {
    const completedGiveaways = db.prepare(`
      SELECT id, winner_ids_json, COALESCE(ended_at, created_at) AS won_at
      FROM giveaways
      WHERE winner_ids_json IS NOT NULL
    `).all();
    const insertWinner = db.prepare(`
      INSERT OR IGNORE INTO giveaway_winner_history (giveaway_id, user_id, won_at)
      VALUES (?, ?, ?)
    `);
    for (const giveaway of completedGiveaways) {
      let winnerIds;
      try {
        winnerIds = JSON.parse(giveaway.winner_ids_json);
      } catch (error) {
        console.error(`Could not migrate winner history for giveaway #${giveaway.id}:`, error);
        continue;
      }
      if (!Array.isArray(winnerIds)) continue;
      for (const userId of new Set(winnerIds)) {
        if (typeof userId === "string" && userId.length) {
          insertWinner.run(giveaway.id, userId, giveaway.won_at);
        }
      }
    }
  })();
}

function getUniqueEligibleCandidates(entries, excludedUserIds, allowBots) {
  const candidates = new Map();
  for (const entry of entries) {
    if (typeof entry.user_id !== "string" ||
        excludedUserIds.has(entry.user_id) ||
        (entry.bot && !allowBots) ||
        !Number.isSafeInteger(entry.weight) ||
        entry.weight <= 0) {
      continue;
    }

    const existing = candidates.get(entry.user_id);
    if (!existing || entry.weight > existing.weight) {
      candidates.set(entry.user_id, { user_id: entry.user_id, weight: entry.weight });
    }
  }
  return [...candidates.values()];
}

function selectWeightedGiveawayWinners(entries, winnerCount, excludedUserIds = new Set(), { allowBots = false } = {}) {
  const candidates = getUniqueEligibleCandidates(entries, excludedUserIds, allowBots);
  const winners = [];
  while (winners.length < winnerCount && candidates.length) {
    const totalWeight = candidates.reduce((sum, entry) => sum + entry.weight, 0);
    if (!Number.isSafeInteger(totalWeight) || totalWeight <= 0 || totalWeight > 2 ** 48) {
      throw new Error("Giveaway entry weights exceed the secure random selection range.");
    }
    let selection = randomInt(totalWeight);
    const selectedIndex = candidates.findIndex(entry => {
      selection -= entry.weight;
      return selection < 0;
    });
    winners.push(candidates[selectedIndex].user_id);
    candidates.splice(selectedIndex, 1);
  }
  return winners;
}

function drawAndRecordGiveawayWinners(db, giveawayId, entries, winnerCount, {
  allowBots = false,
  allowPartial = false,
  expectedStatus
} = {}) {
  const draw = db.transaction(() => {
    const giveaway = db.prepare(`
      SELECT status, winner_ids_json
      FROM giveaways
      WHERE id = ?
    `).get(giveawayId);
    if (!giveaway || giveaway.status !== expectedStatus) {
      return { error: "The giveaway changed before winners could be selected. Please try again." };
    }

    const previousWinners = new Set(
      db.prepare(`
        SELECT user_id
        FROM giveaway_winner_history
        WHERE giveaway_id = ?
      `).all(giveawayId).map(row => row.user_id)
    );
    const currentWinners = JSON.parse(giveaway.winner_ids_json || "null");
    if (Array.isArray(currentWinners)) {
      for (const userId of currentWinners) {
        if (typeof userId === "string") previousWinners.add(userId);
      }
    }

    const candidates = getUniqueEligibleCandidates(entries, previousWinners, allowBots);
    const winnerIds = selectWeightedGiveawayWinners(candidates, winnerCount, previousWinners, { allowBots });
    if (!allowPartial && winnerIds.length < winnerCount) {
      return {
        error: `Only ${candidates.length} eligible participant(s) remain who haven't won. ${winnerCount} new winner(s) are required; no reroll was made.`
      };
    }

    const updated = db.prepare(`
      UPDATE giveaways
      SET winner_ids_json = ?, announcement_message_id = NULL
      WHERE id = ? AND status = ?
    `).run(JSON.stringify(winnerIds), giveawayId, expectedStatus);
    if (!updated.changes) {
      return { error: "The giveaway changed before winners could be saved. Please try again." };
    }

    const insertWinner = db.prepare(`
      INSERT INTO giveaway_winner_history (giveaway_id, user_id, won_at)
      VALUES (?, ?, ?)
    `);
    const wonAt = Date.now();
    for (const userId of winnerIds) {
      insertWinner.run(giveawayId, userId, wonAt);
    }
    return { winnerIds };
  });
  return draw.immediate();
}

module.exports = {
  drawAndRecordGiveawayWinners,
  migrateGiveawayWinnerHistory,
  selectWeightedGiveawayWinners
};
