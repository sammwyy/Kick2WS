package com.sammwy.kick2ws.events;

public record KicksGifted(
        KickUser broadcaster,
        KickUser sender,
        Gift gift,
        String createdAt) {

    public record Gift(
            Integer amount,
            String name,
            String type,
            String tier,
            String message,
            Integer pinnedTimeSeconds) {}
}
