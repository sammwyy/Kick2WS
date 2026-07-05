package com.sammwy.kick2ws;

/** Identity of the token/session the client is authenticated as. */
public record Me(String id, String channelId, String username) {}
