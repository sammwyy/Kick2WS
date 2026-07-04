package com.sammwy.kick2ws.events;

public record ModerationBanned(
        KickUser broadcaster,
        KickUser moderator,
        KickUser bannedUser,
        Metadata metadata) {

    public record Metadata(String reason, String createdAt, String expiresAt) {}
}
