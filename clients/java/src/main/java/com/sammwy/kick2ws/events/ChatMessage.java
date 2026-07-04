package com.sammwy.kick2ws.events;

public record ChatMessage(
        String messageId,
        KickUser broadcaster,
        KickUser sender,
        String content,
        String createdAt) {}
