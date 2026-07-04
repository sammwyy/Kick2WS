package com.sammwy.kick2ws.events;

public record LivestreamStatus(
        KickUser broadcaster,
        Boolean isLive,
        String title,
        String startedAt,
        String endedAt) {}
