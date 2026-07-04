package com.sammwy.kick2ws.events;

/** A Kick user as it appears in webhook payloads (broadcaster, sender, etc.). */
public record KickUser(
        Boolean isAnonymous,
        Long userId,
        String username,
        Boolean isVerified,
        String profilePicture,
        String channelSlug) {}
