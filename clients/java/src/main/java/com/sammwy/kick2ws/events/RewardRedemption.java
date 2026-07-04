package com.sammwy.kick2ws.events;

/** Payload for channel.reward.redemption.updated (channel points). */
public record RewardRedemption(
        String id,
        String userInput,
        String status,
        String redeemedAt,
        Reward reward,
        KickUser redeemer,
        KickUser broadcaster) {

    public record Reward(String id, String title, Integer cost, String description) {}
}
