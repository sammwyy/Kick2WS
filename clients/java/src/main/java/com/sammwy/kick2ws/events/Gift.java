package com.sammwy.kick2ws.events;

import java.util.List;

/** Payload for channel.subscription.gifts. */
public record Gift(
        KickUser broadcaster,
        KickUser gifter,
        List<KickUser> giftees,
        String createdAt,
        String expiresAt) {}
