package com.sammwy.kick2ws.events;

/** Payload for channel.subscription.new and channel.subscription.renewal. */
public record Subscription(
        KickUser broadcaster,
        KickUser subscriber,
        Integer duration,
        String createdAt,
        String expiresAt) {}
